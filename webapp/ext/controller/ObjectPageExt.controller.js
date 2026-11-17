sap.ui.define(
  [
    "sap/ui/core/mvc/ControllerExtension",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/base/Log",
    "com.jhah.zhrjhahsecid1/ext/util/UserRole",
    "com.jhah.zhrjhahsecid1/ext/util/Constants"
  ],
  function (
    ControllerExtension,
    Fragment,
    JSONModel,
    Filter,
    FilterOperator,
    MessageToast,
    Log,
    UserRole,
    Constants
  ) {
    "use strict";

    const LOG_COMPONENT = Constants.LOG_COMPONENT.OBJECT_PAGE;
    const MODEL = Constants.MODEL;
    const CSS_CLASS = Constants.CSS_CLASS;

    /**
     * Object Page extension for the ID request.
     *
     * Configured elsewhere (no code here):
     *  - texts (Submit, delete/cancel confirmations) ......... i18n/fe.properties via enhanceI18n
     *  - Grant / Reject per access area ...................... annotations (inline actions)
     *  - required fields ..................................... annotations (Common.FieldControl)
     *  - table settings, custom sections and actions ......... manifest.json
     *
     * Handled here:
     *  - view state classes (role, ownership, edit/draft) for the transitional CSS action gate
     *  - employee details strip in the header (MODEL.EMPLOYEE_INFO model)
     *  - areas already granted/requested elsewhere (MODEL.AREA_INFO model)
     *  - "Select Access Areas" dialog (manifest custom action)
     */
    return ControllerExtension.extend(
      "com.jhah.zhrjhahsecid1.ext.controller.ObjectPageExt",
      {
        override: {
          onInit: function () {
            var oView = this.base.getView();

            oView.setModel(new JSONModel({ isVisible: false }), MODEL.EMPLOYEE_INFO);
            oView.setModel(
              new JSONModel({ lockedText: "", locked: {} }),
              MODEL.AREA_INFO
            );

            UserRole.applyModeClass(oView, this.base.getAppComponent().getModel());
            this._iBindingRun = 0;
          },

          onExit: function () {
            this._detachPayrollWatcher();
            if (this._oEditModeBinding) {
              this._oEditModeBinding.destroy();
            }
          },

          routing: {
            onAfterBinding: function (oContext) {
              this._bindEditModeClass();
              if (!oContext) {
                return;
              }
              var iRun = ++this._iBindingRun;
              this._applyRecordStateClasses(oContext, iRun);
              this._watchPayrollNumber(oContext, iRun);
            }
          }
        },

        // ==================================================================
        // View state classes (consumed by css/custom.css "Transitional action gate")
        // ==================================================================

        _bindEditModeClass: function () {
          if (this._oEditModeBinding) {
            return;
          }
          var oView = this.base.getView();
          var oUiModel = this.base.getExtensionAPI().getModel(MODEL.UI);
          this._oEditModeBinding = oUiModel.bindProperty("/isEditable");
          var fnUpdate = function () {
            oView.toggleStyleClass(CSS_CLASS.EDIT, !!oUiModel.getProperty("/isEditable"));
          };
          this._oEditModeBinding.attachChange(fnUpdate);
          fnUpdate();
        },

        /**
         * myRequestMode / otherRequestMode / draftMode. Until IsMyRequest is known the view
         * carries loadingOwnershipMode so ownership-gated buttons don't flash.
         */
        _applyRecordStateClasses: function (oContext, iRun) {
          var oView = this.base.getView();
          oView.addStyleClass(CSS_CLASS.OWNERSHIP_LOADING);
          oView.removeStyleClass(CSS_CLASS.MY_REQUEST);
          oView.removeStyleClass(CSS_CLASS.OTHER_REQUEST);

          Promise.all([
            oContext.requestProperty("IsMyRequest"),
            oContext.requestProperty("IsActiveEntity"),
            oContext.requestProperty("HasActiveEntity")
          ])
            .then(
              function (aValues) {
                if (iRun !== this._iBindingRun) {
                  return;
                }
                var bIsDraft = aValues[1] === false;
                var bIsNew = bIsDraft && aValues[2] === false;
                var bIsMine = bIsNew || aValues[0] === true;

                oView.toggleStyleClass(CSS_CLASS.MY_REQUEST, bIsMine);
                oView.toggleStyleClass(CSS_CLASS.OTHER_REQUEST, !bIsMine);
                oView.toggleStyleClass(CSS_CLASS.DRAFT, bIsDraft);
                oView.removeStyleClass(CSS_CLASS.OWNERSHIP_LOADING);
              }.bind(this)
            )
            .catch(function (oError) {
              Log.error("Could not read request state", oError, LOG_COMPONENT);
            });
        },

        // ==================================================================
        // Employee details + areas already held by the employee
        // ==================================================================

        /**
         * Loads employee data and existing areas for the request's payroll number, and again
         * whenever the payroll number changes while editing a draft.
         */
        _watchPayrollNumber: function (oContext, iRun) {
          this._detachPayrollWatcher();

          var sLoadedFor = null;
          var fnLoad = function () {
            if (iRun !== this._iBindingRun) {
              return;
            }
            var sPayrollNum = String(oContext.getProperty("PayrollNum") || "").trim();
            if (sPayrollNum === sLoadedFor) {
              return; // initial read and the binding's first change event report the same value
            }
            sLoadedFor = sPayrollNum;
            var sRequestId = String(oContext.getProperty("RequestId") || "").trim();
            this._loadEmployee(sPayrollNum, iRun);
            this._loadExistingAreas(sPayrollNum, sRequestId, iRun);
          }.bind(this);

          this._oPayrollBinding = oContext
            .getModel()
            .bindProperty("PayrollNum", oContext);
          this._oPayrollBinding.attachChange(fnLoad);
          this._oPayrollBinding.initialize();

          Promise.all([
            oContext.requestProperty("PayrollNum"),
            oContext.requestProperty("RequestId")
          ]).then(fnLoad, function (oError) {
            Log.error("Could not read payroll number", oError, LOG_COMPONENT);
          });
        },

        _detachPayrollWatcher: function () {
          if (this._oPayrollBinding) {
            this._oPayrollBinding.destroy();
            this._oPayrollBinding = null;
          }
        },

        _loadEmployee: function (sPayrollNum, iRun) {
          var oEmployeeModel = this.base.getView().getModel(MODEL.EMPLOYEE_INFO);
          if (!sPayrollNum || sPayrollNum === "0") {
            oEmployeeModel.setData({ isVisible: false });
            return;
          }
          if (oEmployeeModel.getProperty("/Pernr") === sPayrollNum) {
            return;
          }

          // A filtered list (not a key read): an unknown payroll number gives an empty result
          // instead of a 404 that the model would report to the user as an error.
          this.base
            .getAppComponent()
            .getModel()
            .bindList(
              "/EmployeeDetails",
              null,
              null,
              [new Filter("Pernr", FilterOperator.EQ, sPayrollNum)],
              { $$groupId: "$direct" }
            )
            .requestContexts(0, 1)
            .then(
              function (aContexts) {
                if (iRun !== this._iBindingRun) {
                  return;
                }
                var oData = aContexts[0] && aContexts[0].getObject();
                oEmployeeModel.setData(Object.assign({}, oData, { isVisible: !!oData }));
              }.bind(this)
            )
            .catch(
              function (oError) {
                if (iRun === this._iBindingRun) {
                  oEmployeeModel.setData({ isVisible: false });
                }
                Log.warning("Employee details not available", oError, LOG_COMPONENT);
              }.bind(this)
            );
        },

        /**
         * Areas the employee already holds or has requested in *another* request. They are shown
         * in the "Current Access" strip and cannot be (de)selected in the area dialog.
         *
         * @returns {Promise<void>}
         */
        _loadExistingAreas: function (sPayrollNum, sRequestId, iRun) {
          var oAreaModel = this.base.getView().getModel(MODEL.AREA_INFO);
          if (!sPayrollNum) {
            oAreaModel.setData({ lockedText: "", locked: {} });
            return Promise.resolve();
          }

          var oBinding = this.base
            .getAppComponent()
            .getModel()
            .bindList(
              "/existingAreas",
              null,
              null,
              [new Filter("PayrollNum", FilterOperator.EQ, sPayrollNum)],
              { $$groupId: "$direct" }
            );

          return oBinding
            .requestContexts(0, Infinity)
            .then(
              function (aContexts) {
                if (iRun !== undefined && iRun !== this._iBindingRun) {
                  return;
                }
                var mLocked = {};
                aContexts.forEach(function (oCtx) {
                  var oData = oCtx.getObject();
                  var sCode = String(oData.AreaCode || "").trim();
                  var sOwner = String(oData.RequestId || "").trim();
                  if (!sCode || !sOwner || sOwner === sRequestId || mLocked[sCode]) {
                    return;
                  }
                  mLocked[sCode] = {
                    name: oData.AreaDesc || sCode,
                    statusDesc: oData.StatusDesc || "",
                    state: oData.StatusValueState || "None",
                    tooltip: oData.StatusTooltip || oData.StatusDesc || ""
                  };
                });
                oAreaModel.setData({
                  locked: mLocked,
                  lockedText: this._buildLockedText(mLocked)
                });
              }.bind(this)
            )
            .catch(function (oError) {
              Log.warning("Existing areas not available", oError, LOG_COMPONENT);
            });
        },

        _buildLockedText: function (mLocked) {
          var aNames = Object.keys(mLocked).map(function (sCode) {
            return mLocked[sCode].name;
          });
          if (!aNames.length) {
            return "";
          }
          var oBundle = this._getBundle();
          var sList = aNames.slice(0, Constants.MAX_LOCKED_AREAS_IN_TEXT).join(", ");
          if (aNames.length > Constants.MAX_LOCKED_AREAS_IN_TEXT) {
            sList += " " + oBundle.getText("existingAccessMore", [aNames.length - Constants.MAX_LOCKED_AREAS_IN_TEXT]);
          }
          return oBundle.getText("existingAccessText", [sList]);
        },

        // ==================================================================
        // "Select Access Areas" (manifest custom action on the _items table)
        // ==================================================================

        openAreaSelectionDialog: function () {
          var oHeaderContext = this.base.getExtensionAPI().getBindingContext();
          if (!oHeaderContext) {
            return;
          }
          var sPayrollNum = String(oHeaderContext.getProperty("PayrollNum") || "").trim();
          var sRequestId = String(oHeaderContext.getProperty("RequestId") || "").trim();

          // Own binding on the draft's _items; the FE table is refreshed after changes.
          this._oItemsBinding = oHeaderContext
            .getModel()
            .bindList("_items", oHeaderContext, null, null, { $$ownRequest: true });

          Promise.all([
            this._oItemsBinding.requestContexts(0, Infinity),
            this._loadExistingAreas(sPayrollNum, sRequestId),
            this._getAreaDialog()
          ])
            .then(
              function (aResults) {
                var mCurrent = {};
                aResults[0].forEach(function (oCtx) {
                  var sCode = String(oCtx.getProperty("AreaCode") || "").trim();
                  if (sCode) {
                    mCurrent[sCode] = oCtx;
                  }
                });
                this._mCurrentAreaContexts = mCurrent;
                this._mAreaSelection = {};
                Object.keys(mCurrent).forEach(function (sCode) {
                  this._mAreaSelection[sCode] = mCurrent[sCode].getProperty("AreaDesc") || sCode;
                }, this);

                var oView = this.base.getView();
                var oDialog = aResults[2];
                var oList = oView.byId("areaList");
                var oBinding = oList.getBinding("items");
                oView.byId("areaSearchField").setValue("");
                if (oBinding.isSuspended()) {
                  oBinding.resume();
                } else {
                  oBinding.filter([]);
                }
                this.applyAreaSelection();
                oDialog.open();
              }.bind(this)
            )
            .catch(
              function (oError) {
                Log.error("Area dialog could not be opened", oError, LOG_COMPONENT);
                MessageToast.show(this._getBundle().getText("areasLoadFailed"));
              }.bind(this)
            );
        },

        _getAreaDialog: function () {
          if (!this._pAreaDialog) {
            var oView = this.base.getView();
            this._pAreaDialog = Fragment.load({
              id: oView.getId(),
              name: "com.jhah.zhrjhahsecid1.ext.fragment.AreaSelectDialog",
              controller: this
            }).then(function (oDialog) {
              oView.addDependent(oDialog);
              return oDialog;
            });
          }
          return this._pAreaDialog;
        },

        _getLockedAreas: function () {
          return this.base.getView().getModel(MODEL.AREA_INFO).getProperty("/locked") || {};
        },

        _getItemCode: function (oItem) {
          var oCtx = oItem && oItem.getBindingContext();
          return oCtx ? String(oCtx.getProperty("AreaCode") || "").trim() : "";
        },

        /** Re-applies the selection map to the rendered items (after open and every search). */
        applyAreaSelection: function () {
          var oList = this.base.getView().byId("areaList");
          var mLocked = this._getLockedAreas();
          var mSelection = this._mAreaSelection || {};
          oList.getItems().forEach(function (oItem) {
            var sCode = this._getItemCode(oItem);
            oItem.setSelected(!!(sCode && (mLocked[sCode] || mSelection[sCode])));
          }, this);
        },

        // Formatters for the dialog items (AreaSelectDialog.fragment.xml)
        formatLockInfo: function (sCode, mLocked) {
          var oLock = (mLocked || {})[String(sCode || "").trim()];
          return oLock ? oLock.statusDesc : "";
        },
        formatLockState: function (sCode, mLocked) {
          var oLock = (mLocked || {})[String(sCode || "").trim()];
          return oLock ? oLock.state : "None";
        },
        formatLockTooltip: function (sCode, mLocked) {
          var oLock = (mLocked || {})[String(sCode || "").trim()];
          return oLock ? oLock.tooltip : "";
        },

        onAreaSearch: function (oEvent) {
          var sValue = String(oEvent.getParameter("newValue") || oEvent.getParameter("query") || "").trim();
          this.base
            .getView()
            .byId("areaList")
            .getBinding("items")
            .filter(sValue ? [new Filter("AccessArea", FilterOperator.Contains, sValue)] : []);
        },

        /** Keeps the selection map in sync; areas held by another request cannot be changed. */
        onAreaSelectionChange: function (oEvent) {
          var mLocked = this._getLockedAreas();
          var bSelected = oEvent.getParameter("selected");
          var bRefused = false;
          (oEvent.getParameter("listItems") || []).forEach(function (oItem) {
            var sCode = this._getItemCode(oItem);
            if (!sCode) {
              return;
            }
            if (mLocked[sCode]) {
              oItem.setSelected(true);
              bRefused = bRefused || !bSelected;
            } else if (bSelected) {
              this._mAreaSelection[sCode] = oItem.getTitle() || sCode;
            } else {
              delete this._mAreaSelection[sCode];
            }
          }, this);
          if (bRefused) {
            MessageToast.show(this._getBundle().getText("areaAssignedToOtherRequest"));
          }
        },

        onAreaCancel: function () {
          this.base.getView().byId("areaSelectDialog").close();
        },

        /**
         * Applies the difference between the selection and the draft's _items: deletes
         * deselected rows, creates newly selected ones, sets AreaRequested and refreshes the
         * affected parts of the page. Areas held by another request are never added.
         */
        onAreaConfirm: function () {
          var oView = this.base.getView();
          var oExtensionAPI = this.base.getExtensionAPI();
          var oHeaderContext = oExtensionAPI.getBindingContext();
          var oBinding = this._oItemsBinding;
          var mCurrent = this._mCurrentAreaContexts || {};
          var mLocked = this._getLockedAreas();
          var mSelection = this._mAreaSelection || {};
          var aWanted = Object.keys(mSelection).filter(function (sCode) {
            return !mLocked[sCode];
          });

          oView.byId("areaSelectDialog").close();

          var aChanges = [];
          Object.keys(mCurrent).forEach(function (sCode) {
            if (aWanted.indexOf(sCode) === -1) {
              aChanges.push(mCurrent[sCode].delete());
            }
          });
          aWanted.forEach(function (sCode) {
            if (!mCurrent[sCode]) {
              var sName = mSelection[sCode];
              aChanges.push(
                oBinding.create({ AreaCode: sCode, AreaName: sName, AreaDesc: sName }, true).created()
              );
            }
          });

          Promise.all(aChanges)
            .then(function () {
              return oHeaderContext.setProperty("AreaRequested", aWanted.length > 0);
            })
            .then(function () {
              return oExtensionAPI.refresh(["_items", "HideAreaTab"]);
            })
            .then(
              function () {
                MessageToast.show(this._getBundle().getText("areasUpdated"));
              }.bind(this)
            )
            .catch(
              function (oError) {
                Log.error("Access areas could not be updated", oError, LOG_COMPONENT);
                MessageToast.show(this._getBundle().getText("areasUpdateFailed"));
                oExtensionAPI.refresh(["_items"]);
              }.bind(this)
            );
        },


        _getBundle: function () {
          return this.base.getAppComponent().getModel(MODEL.I18N).getResourceBundle();
        }
      }
    );
  }
);
