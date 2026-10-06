sap.ui.define([
    "sap/ui/core/mvc/ControllerExtension",
    "sap/ui/core/Element",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Input",
    "sap/m/DatePicker",
    "sap/ui/layout/form/FormElement",
    "sap/m/Label",
    "sap/m/Text",
    "sap/m/Button"
], function (ControllerExtension, Element, JSONModel, Fragment, MessageToast, MessageBox, Input, DatePicker, FormElement, Label, Text, Button) {
    "use strict";

    return ControllerExtension.extend("com.jhah.zhrjhahsecid.ext.controller.ObjectPageExt", {

        _sLatestRequestedId: null,
        _oPayrollBinding: null,
        _activeSlotInput: null,
        _oActiveIDLoadPromise: null,
        _oScheduleDatePicker: null,
        _oScheduleDateDisplay: null,
        _oScheduleSlotInput: null,
        _oScheduleTimeDisplay: null,
        _oScheduleActionContext: null,
        _oNativeApptFromField: null,
        _oNativeApptToField: null,
        _oCustomDatePicker: null,
        _oCustomSlotInput: null,
        _oActionContext: null,
        _oScheduleParamDateField: null,
        _oScheduleParamFromField: null,
        _oScheduleParamToField: null,
        _oScheduleParamLocationField: null,
        _oScheduleParamSlotIdField: null,

        _bHrStripAllowed: false,
        _sLastLoggedReqType: "",

        _pAreaDialog: null,
        _bAreaDebug: true,
        _mDraftAreaMap: {},
        _mExistingAreaMap: {},
        _mAreaSelection: {},
        _sCurrentRequestId: "",
        _sCurrentPayrollNum: "",
        _oCurrentTableBinding: null,
        _bRestoringAreaSelection: false,
        _pEditingStatusReset: null,
        _bAreaDeleteDialogOpening: false,
        _bSuppressStandardDraftDelete: false,
        _bAccessAreaDeletePending: false,
        _bHeaderDeletePending: false,
        _aPendingAccessAreaDeleteContexts: null,
        _oAreaDeleteYesHandler: null,
        _oAreaDeleteNoHandler: null,



        _log: function (sMessage, oData) {
            var sLog = "[JHAH-EXT] " + sMessage;
            if (oData !== undefined) console.log(sLog, oData);
            else console.log(sLog);
        },



        _areaLog: function (sEvent, oData) {
            if (!this._bAreaDebug) return;
            var oPayload = Object.assign({ timestamp: new Date().toISOString() }, oData || {});
            console.log("[JHAH-AREA] " + String(sEvent || "INFO"), oPayload);
        },

        _logAreaState: function (sReason) {
            this._areaLog("STATE", {
                reason: sReason,
                requestId: this._sCurrentRequestId,
                payrollNum: this._sCurrentPayrollNum,
                draftAreas: Object.keys(this._mDraftAreaMap || {}),
                selectedAreas: Object.keys(this._mAreaSelection || {}),
                existingAreas: Object.keys(this._mExistingAreaMap || {})
            });
        },

        _applyTabAuthorizations: function (sMode) {
            var oView = this.base.getView();
            if (!oView) return;

            var aTabs = oView.findAggregatedObjects(true, function (o) {
                return o.isA("sap.m.IconTabFilter") || o.isA("sap.m.SegmentedButtonItem");
            });

            if (aTabs.length === 0) return;

            var bChangesMade = false;

            aTabs.forEach(function (oTab) {
                var sKey = "";
                if (typeof oTab.getKey === "function") sKey = oTab.getKey();
                if (typeof oTab.getId === "function" && !sKey) sKey = oTab.getId();

                if (!sKey) return;

                var bShouldBeVisible = true;
                var sTargetKey = sKey.toUpperCase();

                if (sMode === "employeeMode") {
                    if (sTargetKey.indexOf("HRTABKEY") !== -1 || sTargetKey.indexOf("ADMINTABKEY") !== -1) bShouldBeVisible = false;
                } else if (sMode === "hrMode") {
                    if (sTargetKey.indexOf("ADMINTABKEY") !== -1) bShouldBeVisible = false;
                } else if (sMode === "securityMode") {
                    if (sTargetKey.indexOf("HRTABKEY") !== -1) bShouldBeVisible = false;
                }

                if (typeof oTab.getVisible === "function" && oTab.getVisible() !== bShouldBeVisible) {
                    oTab.setVisible(bShouldBeVisible);
                    bChangesMade = true;
                    this._log("Tab Visibility Updated via UI5", { TabKey: sKey, Visible: bShouldBeVisible, Mode: sMode });
                }
            }.bind(this));
        },

        _checkAndApplyRoleAuth: function (oAppModel) {
            if (window._jhahAuthChecked) return;
            window._jhahAuthChecked = true;
            var oExtension = this;

            var sDebugRoleOverride = "";

            var applyMode = function (sMode) {
                document.body.classList.remove("employeeMode", "securityMode", "hrMode");
                document.body.classList.add(sMode);
                document.body.classList.add("rolesLoaded");
                window._jhahCurrentMode = sMode;
                oExtension._log("Role verified and applied: " + sMode);
                oExtension._applyTabAuthorizations(sMode);
                oExtension._loadActiveIDAndFragment();
            };

            var sUserId = "UNKNOWN";
            try { if (sap.ushell && sap.ushell.Container) sUserId = sap.ushell.Container.getService("UserInfo").getId().toUpperCase().trim(); } catch (e) { }
            window._jhahUserId = sUserId;
            var sHost = window.location.hostname || "";

            if (sDebugRoleOverride !== "") {
                oExtension._log("HARDCODED DEBUG ROLE APPLIED: " + sDebugRoleOverride);
                if (sDebugRoleOverride === "ADMIN" || sDebugRoleOverride === "SECURITY") applyMode("securityMode");
                else if (sDebugRoleOverride === "HR") applyMode("hrMode");
                else applyMode("employeeMode");
                return;
            }

            if (sUserId === "DEFAULT_USER" || sHost.indexOf("applicationstudio") !== -1 || sHost.indexOf("localhost") !== -1) {
                oExtension._log("Local environment detected. Defaulting to HR mode.");
                applyMode("securityMode");
                return;
            }

            try {
                var oListBinding = oAppModel.bindList("/authInfo", null, null, null, { $$groupId: "$direct" });
                oListBinding.requestContexts(0, 1).then(function (aContexts) {
                    if (aContexts && aContexts.length > 0) {
                        var oUserData = aContexts[0].getObject();
                        var sRole = String(oUserData.ROLE || "").toUpperCase().trim();
                        oExtension._log("Backend Role Retrieved: " + sRole);
                        if (sRole === "ADMIN" || sRole === "SECURITY") applyMode("securityMode");
                        else if (sRole === "HR" || sRole === "HRADMIN") applyMode("hrMode");
                        else applyMode("employeeMode");
                    } else {
                        oExtension._log("No backend role retrieved. Defaulting to Employee.");
                        applyMode("employeeMode");
                    }
                }).catch(function () {
                    oExtension._log("Auth request failed. Defaulting to Employee.");
                    applyMode("employeeMode");
                });
            } catch (e) {
                oExtension._log("Auth binding error.", e);
                applyMode("employeeMode");
            }
        },

        _setHrStripVisibility: function () {
            var oView = this.base.getView();
            if (!oView) return;
            var $strip = oView.$().find(".nativeViolatorStrip");
            if (!$strip || $strip.length === 0) return;

            if (this._bHrStripAllowed === true) {
                $strip.removeClass("jhahHideElement").addClass("jhahShowHrStrip");
            } else {
                $strip.removeClass("jhahShowHrStrip").addClass("jhahHideElement");
            }
        },

        _getLiveRequestType: function (oView, oEntityData) {
            var oExtension = this;
            var sReqTypeKey = "";
            var sReqTypeText = "";

            var aControls = oView.findAggregatedObjects(true, function (oControl) {
                if (!oControl || typeof oControl.getBindingPath !== "function") return false;
                var sSelectedKeyPath = String(oControl.getBindingPath("selectedKey") || "").toLowerCase();
                var sValuePath = String(oControl.getBindingPath("value") || "").toLowerCase();
                return (sSelectedKeyPath.indexOf("reqtype") !== -1 || sValuePath.indexOf("reqtype") !== -1);
            });

            for (var i = 0; i < aControls.length; i++) {
                var oControl = aControls[i];
                if (typeof oControl.getSelectedKey === "function") {
                    sReqTypeKey = String(oControl.getSelectedKey() || "").trim();
                    if (typeof oControl.getSelectedItem === "function") {
                        var oSelectedItem = oControl.getSelectedItem();
                        if (oSelectedItem) {
                            if (typeof oSelectedItem.getKey === "function") sReqTypeKey = String(oSelectedItem.getKey() || "").trim();
                            if (typeof oSelectedItem.getText === "function") sReqTypeText = String(oSelectedItem.getText() || "").trim();
                        }
                    }
                    if (sReqTypeKey) break;
                }
            }

            if (!sReqTypeKey) {
                sReqTypeKey = String(oEntityData.ReqType || "").trim();
                sReqTypeText = sReqTypeKey;
            }

            if (oExtension._sLastLoggedReqType !== sReqTypeKey) {
                oExtension._sLastLoggedReqType = sReqTypeKey;
            }
            return sReqTypeKey;
        },

        _attachRequestTypeChangeHandler: function (oView) {
            var oExtension = this;

            if (oView.__jhahReqTypeHandlerAttached) return;

            var aControls = oView.findAggregatedObjects(true, function (oControl) {
                if (!oControl || typeof oControl.getBindingPath !== "function") return false;
                var sPath = String(oControl.getBindingPath("selectedKey") || "").toLowerCase();
                return (sPath.indexOf("reqtype") !== -1);
            });

            if (aControls.length === 0) return;

            aControls.forEach(function (oControl) {
                if (typeof oControl.attachSelectionChange === "function") {
                    oControl.attachSelectionChange(function (oEvent) {
                        setTimeout(function () { oExtension._refreshRequestTypeRequirementUI(); }, 0);
                    });
                } else if (typeof oControl.attachChange === "function") {
                    oControl.attachChange(function () {
                        setTimeout(function () { oExtension._refreshRequestTypeRequirementUI(); }, 0);
                    });
                }
            });

            oView.__jhahReqTypeHandlerAttached = true;
        },

        _refreshRequestTypeRequirementUI: function () {
            var oView = this.base.getView();
            if (!oView) return;

            var oContext = oView.getBindingContext();
            var oEntityData = oContext ? (oContext.getObject() || {}) : {};

            var sReqType = this._getLiveRequestType(oView, oEntityData);
            var sNormalized = sReqType.toUpperCase().trim();
            var bIsACCS = sNormalized === "ACCS" || sNormalized === "ACCESS UPDATE";
            var bIsEditMode = window.location.hash.indexOf("IsActiveEntity=false") !== -1 || window.location.hash.indexOf("Create") !== -1;

            this._updateAreaRequirementUI(bIsACCS, false, bIsEditMode);
        },

        _loadAllAppointmentSlots: function () {
            var oView = this.base.getView();
            var oSlotModel = oView.getModel("apptslots");

            if (!oSlotModel) {
                oSlotModel = new JSONModel({ dates: [], slotsByDate: {}, minDate: null, maxDate: null, currentSlots: [], selectedKey: "", selectedLabel: "" });
                oView.setModel(oSlotModel, "apptslots");
            } else {
                oSlotModel.setProperty("/selectedKey", "");
                oSlotModel.setProperty("/selectedLabel", "");
                oSlotModel.setProperty("/currentSlots", []);
                if (this._oCustomSlotInput && !this._oCustomSlotInput.bIsDestroyed) this._oCustomSlotInput.setValue("");
            }

            var oAppModel = oView.getModel();
            var oListBinding = oAppModel.bindList("/Appslots", null, null, null, { $$groupId: "$direct" });

            oListBinding.requestContexts(0, 1000).then(function (aContexts) {
                var mByDate = {};
                var aDates = [];
                var oExtension = this;

                aContexts.forEach(function (oCtx) {
                    var oSlot = oCtx.getObject();
                    var sDate = oSlot.AppointmentDate;
                    if (!sDate) return;

                    if (!mByDate[sDate]) {
                        mByDate[sDate] = [];
                        aDates.push(sDate);
                    }

                    var sFromFormat = oExtension._formatTime12h(oSlot.FromTime);
                    var sToFormat = oExtension._formatTime12h(oSlot.ToTime);

                    var iCapacity = parseInt(oSlot.Capacity, 10) || 0;
                    var iBooked = parseInt(oSlot.Booked, 10) || 0;
                    var iBucket = 0;
                    if (iCapacity > 0) {
                        var iPercent = Math.round((iBooked / iCapacity) * 100);
                        iBucket = Math.round(iPercent / 10) * 10;
                        if (iBucket > 100) iBucket = 100;
                    }

                    mByDate[sDate].push({
                        key: oSlot.SlotId + "#" + oSlot.FromTime,
                        SlotId: oSlot.SlotId,
                        FromTime: oSlot.FromTime,
                        ToTime: oSlot.ToTime,
                        full: iCapacity > 0 && iBooked >= iCapacity,
                        rangeLabel: sFromFormat + " - " + sToFormat,
                        bucket: iBucket
                    });
                });

                aDates.sort();
                Object.keys(mByDate).forEach(function (sKey) {
                    mByDate[sKey].sort(function (a, b) { return a.FromTime < b.FromTime ? -1 : (a.FromTime > b.FromTime ? 1 : 0); });
                });

                oSlotModel.setProperty("/dates", aDates);
                oSlotModel.setProperty("/slotsByDate", mByDate);

                if (aDates.length > 0) {
                    var minParts = aDates[0].split("-");
                    var maxParts = aDates[aDates.length - 1].split("-");
                    oSlotModel.setProperty("/minDate", new Date(parseInt(minParts[0], 10), parseInt(minParts[1], 10) - 1, parseInt(minParts[2], 10)));
                    oSlotModel.setProperty("/maxDate", new Date(parseInt(maxParts[0], 10), parseInt(maxParts[1], 10) - 1, parseInt(maxParts[2], 10)));
                }
            }.bind(this));
        },

        _getSafeSelectedDate: function (oTargetInput) {
            var oInput = oTargetInput || this._activeSlotInput;

            if (oInput === this._oScheduleSlotInput && this._oScheduleDatePicker && typeof this._oScheduleDatePicker.getDateValue === "function" && this._oScheduleDatePicker.getVisible()) {
                var oDateSched = this._oScheduleDatePicker.getDateValue();
                if (oDateSched) return oDateSched.getFullYear() + "-" + ((oDateSched.getMonth() + 1) < 10 ? "0" + (oDateSched.getMonth() + 1) : (oDateSched.getMonth() + 1)) + "-" + (oDateSched.getDate() < 10 ? "0" + oDateSched.getDate() : oDateSched.getDate());
            }

            if (oInput === this._oCustomSlotInput && this._oCustomDatePicker && typeof this._oCustomDatePicker.getDateValue === "function" && this._oCustomDatePicker.getVisible()) {
                var oDateCustom = this._oCustomDatePicker.getDateValue();
                if (oDateCustom) return oDateCustom.getFullYear() + "-" + ((oDateCustom.getMonth() + 1) < 10 ? "0" + (oDateCustom.getMonth() + 1) : (oDateCustom.getMonth() + 1)) + "-" + (oDateCustom.getDate() < 10 ? "0" + oDateCustom.getDate() : oDateCustom.getDate());
            }

            var oCtx = (oInput === this._oScheduleSlotInput ? this._oScheduleActionContext : this._oActionContext) || this.base.getView().getBindingContext();
            if (oCtx) {
                var oData = oCtx.getObject() || {};
                var sKey = Object.keys(oData).find(function (k) { return k.toLowerCase().indexOf("apptdate") !== -1 || k.toLowerCase().indexOf("appointmentdate") !== -1; });
                if (sKey && oData[sKey]) return oData[sKey].split("T")[0];
            }
            return null;
        },

        onAppointmentDateChange: function (oEvent, bIsScheduleTab) {
            var oSource = oEvent ? oEvent.getSource() : null;
            var bValid = oEvent ? oEvent.getParameter("valid") : true;
            var oExtension = this;

            setTimeout(function () {
                var oSlotModel = oExtension.base.getView().getModel("apptslots");
                var oContextToUse = bIsScheduleTab ? (oExtension._oScheduleActionContext || oExtension.base.getView().getBindingContext()) : (oExtension._oActionContext || oExtension.base.getView().getBindingContext());
                var oInputToClear = bIsScheduleTab ? oExtension._oScheduleSlotInput : oExtension._oCustomSlotInput;

                var sDate = oExtension._getSafeSelectedDate(oInputToClear);
                var mByDate = oSlotModel.getProperty("/slotsByDate") || {};
                var aSlots = (sDate && mByDate[sDate]) || [];

                oSlotModel.setProperty("/currentSlots", aSlots);
                oSlotModel.setProperty("/selectedKey", "");
                oSlotModel.setProperty("/selectedLabel", "");

                if (oInputToClear && typeof oInputToClear.setValue === "function") {
                    oInputToClear.setValue("");
                }

                if (!bIsScheduleTab) {
                    if (oExtension._oScheduleParamFromField && typeof oExtension._oScheduleParamFromField.setValue === "function") {
                        oExtension._oScheduleParamFromField.setValue("00:00:00");
                        oExtension._oScheduleParamFromField.fireChange({ value: "00:00:00" });
                    }
                    if (oExtension._oScheduleParamToField && typeof oExtension._oScheduleParamToField.setValue === "function") {
                        oExtension._oScheduleParamToField.setValue("00:00:00");
                        oExtension._oScheduleParamToField.fireChange({ value: "00:00:00" });
                    }
                    if (oExtension._oScheduleParamSlotIdField && typeof oExtension._oScheduleParamSlotIdField.setValue === "function") {
                        oExtension._oScheduleParamSlotIdField.setValue("");
                        oExtension._oScheduleParamSlotIdField.fireChange({ value: "" });
                    }
                } else {
                    if (oExtension._oNativeApptFromField && typeof oExtension._oNativeApptFromField.setValue === "function") {
                        oExtension._oNativeApptFromField.setValue("00:00:00");
                        oExtension._oNativeApptFromField.fireChange({ value: "00:00:00" });
                    } else {
                        oExtension._setSafeProperty(oContextToUse, "AppointmentFrom", "00:00:00");
                    }
                    if (oExtension._oNativeApptToField && typeof oExtension._oNativeApptToField.setValue === "function") {
                        oExtension._oNativeApptToField.setValue("00:00:00");
                        oExtension._oNativeApptToField.fireChange({ value: "00:00:00" });
                    } else {
                        oExtension._setSafeProperty(oContextToUse, "AppointmentTo", "00:00:00");
                    }
                }

                if (oSource && typeof oSource.setValueState === "function") {
                    if (!bValid || (sDate && aSlots.length === 0)) {
                        oSource.setValueState("Error");
                        oSource.setValueStateText("Please select an available appointment date.");
                    } else {
                        oSource.setValueState("None");
                        oSource.setValueStateText("");
                    }
                }
            }, 100);
        },

        onAppointmentSlotValueHelp: function (oEvent, bIsScheduleTab) {
            var oView = this.base.getView();

            if (bIsScheduleTab) {
                this._oScheduleActionContext = this._oScheduleActionContext || oView.getBindingContext();
                this._activeSlotInput = this._oScheduleSlotInput;
            } else {
                this._oActionContext = this._oActionContext || oView.getBindingContext();
                this._activeSlotInput = this._oCustomSlotInput;
            }

            if (oEvent && oEvent.getSource) {
                this._activeSlotInput = oEvent.getSource();
            }

            var sDate = this._getSafeSelectedDate(this._activeSlotInput);
            if (!sDate) {
                MessageToast.show("Please select an Appointment Date first to view slots.");
                return;
            }

            var oSlotModel = oView.getModel("apptslots");
            var mByDate = oSlotModel.getProperty("/slotsByDate") || {};
            oSlotModel.setProperty("/currentSlots", mByDate[sDate] || []);

            var sPopoverId = oView.getId() + "--slotPopover";

            if (!this._pSlotPopover) {
                var oExisting = sap.ui.core.Element.registry.get(sPopoverId);
                if (oExisting) oExisting.destroy();

                this._pSlotPopover = Fragment.load({
                    id: sPopoverId,
                    name: "com.jhah.zhrjhahsecid.ext.fragment.TimeSlotPopover",
                    controller: this
                }).then(function (oPopover) {
                    oPopover.addStyleClass("jhahAestheticPopover");
                    oView.addDependent(oPopover);
                    return oPopover;
                });
            }

            this._pSlotPopover.then(function (oPopover) {
                var oTarget = this._activeSlotInput || (bIsScheduleTab ? this._oScheduleSlotInput : this._oCustomSlotInput);
                if (oTarget && !oTarget.bIsDestroyed) {
                    oPopover.openBy(oTarget);
                }
            }.bind(this));
        },

        onAppointmentSlotPress: function (oEvent) {
            var oButton = oEvent.getSource();
            var oSlot = oButton.getBindingContext("apptslots").getObject();
            var oSlotModel = this.base.getView().getModel("apptslots");

            if (!oSlot) return;

            oSlotModel.setProperty("/selectedKey", oSlot.key);
            oSlotModel.setProperty("/selectedLabel", oSlot.rangeLabel);

            var oTargetInput = this._activeSlotInput;

            if (oTargetInput === this._oCustomSlotInput) {
                if (this._oScheduleParamFromField && typeof this._oScheduleParamFromField.setValue === "function") {
                    this._oScheduleParamFromField.setValue(oSlot.FromTime);
                    this._oScheduleParamFromField.fireChange({ value: oSlot.FromTime });
                }
                if (this._oScheduleParamToField && typeof this._oScheduleParamToField.setValue === "function") {
                    this._oScheduleParamToField.setValue(oSlot.ToTime);
                    this._oScheduleParamToField.fireChange({ value: oSlot.ToTime });
                }
                if (this._oScheduleParamSlotIdField && typeof this._oScheduleParamSlotIdField.setValue === "function") {
                    this._oScheduleParamSlotIdField.setValue(String(oSlot.SlotId));
                    this._oScheduleParamSlotIdField.fireChange({ value: String(oSlot.SlotId) });
                }
                this._oCustomSlotInput.setValue(oSlot.rangeLabel);
                this.onAppointmentSlotPopoverCancel();
                return;
            }

            if (oTargetInput === this._oScheduleSlotInput) {
                var oTargetContext = this._oScheduleActionContext || this.base.getView().getBindingContext();
                this._oScheduleSlotInput.setValue(oSlot.rangeLabel);

                if (this._oNativeApptFromField && typeof this._oNativeApptFromField.setValue === "function") {
                    this._oNativeApptFromField.setValue(oSlot.FromTime);
                    this._oNativeApptFromField.fireChange({ value: oSlot.FromTime });
                } else {
                    this._setSafeProperty(oTargetContext, "AppointmentFrom", oSlot.FromTime);
                }

                if (this._oNativeApptToField && typeof this._oNativeApptToField.setValue === "function") {
                    this._oNativeApptToField.setValue(oSlot.ToTime);
                    this._oNativeApptToField.fireChange({ value: oSlot.ToTime });
                } else {
                    this._setSafeProperty(oTargetContext, "AppointmentTo", oSlot.ToTime);
                }

                this.onAppointmentSlotPopoverCancel();
            }
        },

        onAppointmentSlotPopoverCancel: function () {
            if (this._pSlotPopover) {
                this._pSlotPopover.then(function (oPopover) {
                    oPopover.close();
                });
            }
        },

        // ACCESS AREA SELECTION LOGIC
        _loadCurrentDraftAreas: function (oView, oBinding) {
            var oExtension = this;
            var mFound = {};

            function processContext(oContext, sSource) {
                if (!oContext) return Promise.resolve();
                var pAreaCode;
                try {
                    if (typeof oContext.requestProperty === "function") pAreaCode = oContext.requestProperty("AreaCode");
                    else pAreaCode = Promise.resolve(oContext.getProperty("AreaCode"));
                } catch (oError) { return Promise.resolve(); }

                return Promise.resolve(pAreaCode).then(function (vAreaCode) {
                    var sAreaCode = String(vAreaCode || "").trim();
                    if (!sAreaCode) return null;

                    var pAreaName;
                    try {
                        if (typeof oContext.requestProperty === "function") pAreaName = oContext.requestProperty("AreaName");
                        else pAreaName = Promise.resolve(oContext.getProperty("AreaName"));
                    } catch (oError) { pAreaName = Promise.resolve(""); }

                    return Promise.resolve(pAreaName).then(function (vAreaName) {
                        var sAreaName = String(vAreaName || "").trim();
                        if (!sAreaName) {
                            try {
                                if (typeof oContext.requestProperty === "function") {
                                    return oContext.requestProperty("AreaDesc").then(function (vAreaDesc) {
                                        return { areaCode: sAreaCode, areaName: String(vAreaDesc || "").trim() };
                                    });
                                }
                            } catch (oError) { }
                        }
                        return { areaCode: sAreaCode, areaName: sAreaName };
                    });
                }).then(function (oArea) {
                    if (!oArea || !oArea.areaCode) return;
                    mFound[oArea.areaCode] = { context: oContext, code: oArea.areaCode, name: oArea.areaName };
                }).catch(function (oError) { });
            }

            var aTables = [];
            try {
                aTables = oView.findAggregatedObjects(true, function (oControl) {
                    return (oControl && (oControl.isA("sap.m.Table") || oControl.isA("sap.ui.table.Table")));
                }) || [];
            } catch (oError) { aTables = []; }

            var aContextPromises = [];

            aTables.forEach(function (oTable) {
                var oTableBinding = null, sPath = "", sTableId = "";
                try { sTableId = String(oTable.getId() || ""); } catch (e) { }
                try { oTableBinding = oTable.getBinding("items") || oTable.getBinding("rows"); } catch (oError) { return; }
                if (!oTableBinding) return;
                try { sPath = String(oTableBinding.getPath() || ""); } catch (e) { }

                var sPathLower = sPath.toLowerCase();
                var sTableIdLower = sTableId.toLowerCase();

                if (sPathLower.indexOf("existing") !== -1 || sTableIdLower.indexOf("existing") !== -1) return;
                if (sTableIdLower.indexOf("dialog") !== -1 || sTableIdLower.indexOf("popover") !== -1) return;
                if (sPathLower.indexOf("_items") === -1) return;

                oExtension._oCurrentTableBinding = oTableBinding;
            });

            if (!oBinding || typeof oBinding.requestContexts !== "function") {
                oExtension._mDraftAreaMap = {};
                oExtension._mAreaSelection = {};
                return Promise.resolve({});
            }

            return oBinding.requestContexts(0, 1000).then(function (aContexts) {
                (aContexts || []).forEach(function (oContext, iIndex) {
                    aContextPromises.push(processContext(oContext, "requestContexts[" + iIndex + "]"));
                });

                aTables.forEach(function (oTable) {
                    var sPath = "";
                    try {
                        var oTableBinding = oTable.getBinding("items") || oTable.getBinding("rows");
                        if (!oTableBinding) return;
                        sPath = String(oTableBinding.getPath() || "").toLowerCase();
                    } catch (e) { return; }
                    if (sPath.indexOf("_items") === -1) return;

                    if (typeof oTable.getItems === "function") {
                        (oTable.getItems() || []).forEach(function (oItem, iRow) {
                            var oContext = null;
                            try { oContext = oItem.getBindingContext(); } catch (e) { }
                            if (oContext) aContextPromises.push(processContext(oContext, "renderedItems[" + iRow + "]"));
                        });
                    }

                    if (typeof oTable.getRows === "function") {
                        (oTable.getRows() || []).forEach(function (oRow, iRow) {
                            var oContext = null;
                            try { oContext = oRow.getBindingContext(); } catch (e) { }
                            if (oContext) aContextPromises.push(processContext(oContext, "renderedRows[" + iRow + "]"));
                        });
                    }
                });

                return Promise.all(aContextPromises);
            }).then(function () {
                oExtension._mDraftAreaMap = {};
                oExtension._mAreaSelection = {};
                Object.keys(mFound).forEach(function (sAreaCode) {
                    oExtension._mDraftAreaMap[sAreaCode] = mFound[sAreaCode];
                    oExtension._mAreaSelection[sAreaCode] = { code: mFound[sAreaCode].code, name: mFound[sAreaCode].name };
                });
                return mFound;
            }).catch(function (oError) {
                oExtension._mDraftAreaMap = {};
                oExtension._mAreaSelection = {};
                Object.keys(mFound).forEach(function (sAreaCode) {
                    oExtension._mDraftAreaMap[sAreaCode] = mFound[sAreaCode];
                    oExtension._mAreaSelection[sAreaCode] = { code: mFound[sAreaCode].code, name: mFound[sAreaCode].name };
                });
                return mFound;
            });
        },

        _loadExistingAreas: function (oModel, sPernrOverride) {
            var oExtension = this;
            var sPayrollNum = String(sPernrOverride || this._sCurrentPayrollNum || "").trim();
            this._mExistingAreaMap = {};

            if (!sPayrollNum) return Promise.resolve([]);

            var oBinding;
            try {
                // No explicit $select needed, OData V4 will fetch all standard fields automatically
                oBinding = oModel.bindList("/existingAreas", null, null, [
                    new sap.ui.model.Filter("PayrollNum", sap.ui.model.FilterOperator.EQ, sPayrollNum)
                ], {
                    $$groupId: "$direct"
                });
            } catch (oError) { return Promise.reject(oError); }

            return oBinding.requestContexts(0, 5000).then(function (aContexts) {
                (aContexts || []).forEach(function (oContext) {
                    var oData = oContext.getObject() || {};
                    var sAreaCode = String(oData.AreaCode || "").trim();
                    if (!sAreaCode) return;
                    if (!oExtension._mExistingAreaMap[sAreaCode]) oExtension._mExistingAreaMap[sAreaCode] = [];
                    oExtension._mExistingAreaMap[sAreaCode].push({
                        requestId: String(oData.RequestId || "").trim(),
                        status: String(oData.Status || "").trim(),
                        statusDesc: String(oData.StatusDesc || "").trim(),
                        areaDesc: String(oData.AreaDesc || "").trim(),
                        statusValueState: String(oData.StatusValueState || "None").trim(),
                        statusTooltip: String(oData.StatusTooltip || "").trim() // <--- Fetch Tooltip from CDS
                    });
                });
                return aContexts || [];
            });
        },

        _isAreaBlockedByAnotherRequest: function (sAreaCode) {
            sAreaCode = String(sAreaCode || "").trim();
            if (!sAreaCode) return false;
            var aOwners = this._mExistingAreaMap[sAreaCode] || [];
            if (aOwners.length === 0) return false;

            var sCurrentRequestId = String(this._sCurrentRequestId || "").trim();
            return aOwners.some(function (oOwner) {
                var sOwnerRequestId = String(oOwner.requestId || "").trim();
                return (sOwnerRequestId && sOwnerRequestId !== sCurrentRequestId);
            });
        },

        _isAreaExistingAndLocked: function (sAreaCode) {
            sAreaCode = String(sAreaCode || "").trim();
            if (!sAreaCode) return false;
            var aOwners = this._mExistingAreaMap[sAreaCode] || [];
            if (aOwners.length === 0) return false;

            var sCurrentRequestId = String(this._sCurrentRequestId || "").trim();
            return aOwners.some(function (oOwner) {
                var sOwnerRequestId = String(oOwner.requestId || "").trim();
                return (sOwnerRequestId && sOwnerRequestId !== sCurrentRequestId);
            });
        },

        openAreaSelectionDialog: function () {
            var oExtension = this;
            var oView = (this.base && typeof this.base.getView === "function") ? this.base.getView() : this.getView();
            if (!oView) return;
            var oHeaderContext = oView.getBindingContext();
            if (!oHeaderContext) return;
            var oModel = oHeaderContext.getModel();
            if (!oModel) return;

            this._sCurrentRequestId = String(oHeaderContext.getProperty("RequestId") || "").trim();
            this._sCurrentPayrollNum = String(oHeaderContext.getProperty("PayrollNum") || "").trim();
            this._mDraftAreaMap = {};
            this._mAreaSelection = {};
            this._oCurrentTableBinding = null;

            var aTables = oView.findAggregatedObjects(true, function (oControl) { return (oControl.isA("sap.m.Table") || oControl.isA("sap.ui.table.Table")); });
            for (var i = 0; i < aTables.length; i++) {
                var oBinding = aTables[i].getBinding("items") || aTables[i].getBinding("rows");
                if (!oBinding) continue;
                var sPath = String(oBinding.getPath() || "").toLowerCase();
                var sTableId = String(aTables[i].getId() || "").toLowerCase();
                if (sPath.indexOf("existing") !== -1 || sTableId.indexOf("existing") !== -1) continue;
                if (sTableId.indexOf("dialog") !== -1 || sTableId.indexOf("popover") !== -1) continue;
                if (sPath.indexOf("_items") !== -1) { this._oCurrentTableBinding = oBinding; break; }
            }

            if (!this._oCurrentTableBinding) {
                try { this._oCurrentTableBinding = oModel.bindList("_items", oHeaderContext); } catch (oError) { MessageToast.show("Unable to load the current access areas."); return; }
            }

            var pDraftAreas = this._loadCurrentDraftAreas(oView, this._oCurrentTableBinding);
            var pExistingAreas = this._loadExistingAreas(oModel);

            if (!this._pAreaDialog) {
                var oDialogController = { onAreaSearch: this.onAreaSearch.bind(this), onAreaConfirm: this.onAreaConfirm.bind(this) };
                this._pAreaDialog = Fragment.load({
                    id: oView.getId(), name: "com.jhah.zhrjhahsecid.ext.fragment.AreaSelectDialog", controller: oDialogController
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    var oBindingInfo = oDialog.getBindingInfo("items");
                    if (oBindingInfo) {
                        oBindingInfo.parameters = oBindingInfo.parameters || {};
                        oBindingInfo.parameters.$select = "AreaCode,AccessArea";
                        oDialog.bindAggregation("items", oBindingInfo);
                    }
                    var oList = oDialog.getContent ? oDialog.getContent()[0] : oDialog._oList;
                    if (oList) {
                        if (typeof oList.attachSelectionChange === "function") {
                            oList.attachSelectionChange(function (oEvent) {
                                if (oExtension._bRestoringAreaSelection) return;
                                var oItem = oEvent.getParameter("listItem");
                                var bSelected = oEvent.getParameter("selected");
                                if (!oItem) return;
                                var oContext = oItem.getBindingContext();
                                if (!oContext) return;
                                var sAreaCode = String(oContext.getProperty("AreaCode") || "").trim();
                                var sAreaName = String(oContext.getProperty("AccessArea") || "").trim();
                                if (!sAreaCode) return;

                                if (!bSelected && oExtension._isAreaExistingAndLocked(sAreaCode)) {
                                    oExtension._bRestoringAreaSelection = true;
                                    try { oList.setSelectedItem(oItem, true); } finally { oExtension._bRestoringAreaSelection = false; }
                                    return;
                                }
                                if (bSelected && oExtension._isAreaBlockedByAnotherRequest(sAreaCode)) {
                                    oExtension._bRestoringAreaSelection = true;
                                    try { oList.setSelectedItem(oItem, false); } finally { oExtension._bRestoringAreaSelection = false; }
                                    delete oExtension._mAreaSelection[sAreaCode];
                                    MessageToast.show("This access area is already assigned to another request.");
                                    return;
                                }
                                if (bSelected) oExtension._mAreaSelection[sAreaCode] = { code: sAreaCode, name: sAreaName };
                                else delete oExtension._mAreaSelection[sAreaCode];
                            });
                        }
                        if (typeof oList.attachUpdateFinished === "function") {
                            oList.attachUpdateFinished(function () { oExtension._restoreAreaDialogSelection(oList, oDialog); });
                        }
                    }
                    return oDialog;
                });
            }

            Promise.all([pDraftAreas, pExistingAreas, this._pAreaDialog]).then(function (aResults) {
                var oDialog = aResults[2];
                if (!oDialog) return;
                var oDialogBinding = oDialog.getBinding("items");
                if (oDialogBinding) { try { oDialogBinding.filter([]); } catch (oError) { } }
                var oList = oDialog.getContent ? oDialog.getContent()[0] : oDialog._oList;
                if (oList) oExtension._restoreAreaDialogSelection(oList, oDialog);
                oDialog.open();
                setTimeout(function () { oExtension._restoreAreaDialogSelection(oList, oDialog); }, 0);
            }).catch(function (oError) { MessageToast.show("Unable to load the access areas."); });
        },

        _restoreAreaDialogSelection: function (oList, oDialog) {
            var oExtension = this;
            if (!oList || typeof oList.getItems !== "function") return;
            oExtension._bRestoringAreaSelection = true;
            try {
                var aItems = oList.getItems() || [];
                aItems.forEach(function (oItem) {
                    var oContext = oItem.getBindingContext();
                    if (!oContext) return;
                    var sAreaCode = String(oContext.getProperty("AreaCode") || "").trim();
                    if (!sAreaCode) return;

                    if (oExtension._isAreaExistingAndLocked(sAreaCode)) {
                        var aExisting = oExtension._mExistingAreaMap[sAreaCode] || [];
                        var oExistingEntry = aExisting[0] || {};

                        var sStatusDesc = oExistingEntry.statusDesc || "";
                        var sState = oExistingEntry.statusValueState || "None";

                        // Use backend tooltip, fallback to StatusDesc if tooltip is empty
                        var sTooltip = oExistingEntry.statusTooltip || sStatusDesc;

                        oItem.setInfo(sStatusDesc);
                        oItem.setInfoState(sState);
                        oItem.setTooltip(sTooltip); // <--- Apply Tooltip
                        oList.setSelectedItem(oItem, true);
                    } else {
                        oItem.setInfo("");
                        oItem.setInfoState("None");
                        oItem.setTooltip(""); // <--- Clear Tooltip for unlocked areas
                        oList.setSelectedItem(oItem, !!oExtension._mAreaSelection[sAreaCode]);
                    }
                });
                if (oDialog && typeof oDialog._updateSelectionIndicator === "function") { try { oDialog._updateSelectionIndicator(); } catch (e) { } }
            } finally { oExtension._bRestoringAreaSelection = false; }
        },

        onAreaSearch: function (oEvent) {
            var sValue = String(oEvent.getParameter("value") || "").trim();
            var oBinding = oEvent.getSource().getBinding("items");
            if (!oBinding) return;
            try {
                if (!sValue) oBinding.filter([]);
                else oBinding.filter([new sap.ui.model.Filter("AccessArea", sap.ui.model.FilterOperator.Contains, sValue)]);
            } catch (oError) { }
        },

        onAreaConfirm: function (oEvent) {
            var oExtension = this;
            var oView = (this.base && typeof this.base.getView === "function") ? this.base.getView() : this.getView();
            if (!oView) return;
            var oHeaderContext = oView.getBindingContext();
            if (!oHeaderContext) return;
            var oModel = oHeaderContext.getModel();
            if (!oModel) return;

            var mDesiredSelection = Object.assign({}, this._mAreaSelection || {});

            Object.keys(mDesiredSelection).forEach(function (sAreaCode) {
                if (oExtension._isAreaBlockedByAnotherRequest(sAreaCode)) delete mDesiredSelection[sAreaCode];
            });

            var oListBinding = this._oCurrentTableBinding;
            if (!oListBinding) {
                try { oListBinding = oModel.bindList("_items", oHeaderContext); this._oCurrentTableBinding = oListBinding; } catch (oError) { MessageToast.show("Unable to update access areas."); return; }
            }

            var mCurrentDraft = Object.assign({}, oExtension._mDraftAreaMap || {});

            oListBinding.requestContexts(0, 1000).then(function (aContexts) {
                (aContexts || []).forEach(function (oContext) {
                    if (!oContext) return;
                    var oData = oContext.getObject();
                    if (!oData) return;
                    var sAreaCode = String(oData.AreaCode || "").trim();
                    if (!sAreaCode) return;
                    var sAreaName = String(oData.AreaName || oData.AreaDesc || "").trim();
                    if (!mCurrentDraft[sAreaCode]) mCurrentDraft[sAreaCode] = { context: oContext, code: sAreaCode, name: sAreaName };
                });

                var aDeletePromises = [];
                var aCreatePromises = [];

                Object.keys(mCurrentDraft).forEach(function (sAreaCode) {
                    if (mDesiredSelection[sAreaCode]) return;
                    var oDraftEntry = mCurrentDraft[sAreaCode];
                    if (!oDraftEntry || !oDraftEntry.context || typeof oDraftEntry.context.delete !== "function") return;
                    try {
                        var oDeleteResult = oDraftEntry.context.delete("$auto");
                        if (oDeleteResult && typeof oDeleteResult.then === "function") aDeletePromises.push(oDeleteResult);
                    } catch (oError) { aDeletePromises.push(Promise.reject(oError)); }
                });

                Object.keys(mDesiredSelection).forEach(function (sAreaCode) {
                    if (mCurrentDraft[sAreaCode]) return;
                    var oSelection = mDesiredSelection[sAreaCode];
                    try {
                        var oCreatedContext = oListBinding.create({ AreaCode: oSelection.code, AreaName: oSelection.name, AreaDesc: oSelection.name }, true);
                        oExtension._mDraftAreaMap[sAreaCode] = { context: oCreatedContext, code: oSelection.code, name: oSelection.name };
                        if (oCreatedContext && oCreatedContext.created) {
                            var oCreatedPromise = oCreatedContext.created;
                            if (typeof oCreatedPromise.then === "function") aCreatePromises.push(oCreatedPromise);
                        }
                    } catch (oError) { aCreatePromises.push(Promise.reject(oError)); }
                });

                return Promise.all(aDeletePromises.concat(aCreatePromises));
            }).then(function () {
                var aSelectedItems = Object.keys(mDesiredSelection).map(function (sAreaCode) { return mDesiredSelection[sAreaCode]; });
                oExtension._mAreaSelection = Object.assign({}, mDesiredSelection);
                var mPreviousDraftMap = Object.assign({}, oExtension._mDraftAreaMap || {});
                oExtension._mDraftAreaMap = {};

                aSelectedItems.forEach(function (oSelected) {
                    if (!oSelected || !oSelected.code) return;
                    var sCode = oSelected.code;
                    var oExistingEntry = mCurrentDraft[sCode];
                    var oPreviousEntry = mPreviousDraftMap[sCode];
                    oExtension._mDraftAreaMap[sCode] = { context: (oExistingEntry && oExistingEntry.context) || (oPreviousEntry && oPreviousEntry.context) || null, code: sCode, name: oSelected.name };
                });

                oExtension._syncAreaRequested(aSelectedItems, oHeaderContext, oView);
                if (oEvent && oEvent.getSource && typeof oEvent.getSource().close === "function") oEvent.getSource().close();
            }).catch(function (oError) { MessageToast.show("Some access-area changes could not be saved."); });
        },

        _syncAreaRequested: function (aSelectedItems, oHeaderContext, oView) {
            var bHasAreas = Array.isArray(aSelectedItems) && aSelectedItems.length > 0;
            try {
                var oPromise = oHeaderContext.setProperty("AreaRequested", bHasAreas);
                if (oPromise && typeof oPromise.catch === "function") oPromise.catch(function () { });
            } catch (oError) { }

            oView.findAggregatedObjects(true, function (oControl) { return oControl.isA("sap.m.CheckBox"); }).forEach(function (oCheckBox) {
                var sPath = (oCheckBox.getBindingPath("selected") || "").toLowerCase();
                if (sPath.indexOf("arearequested") === -1) return;
                try { oCheckBox.setSelected(bHasAreas); oCheckBox.fireSelect({ selected: bHasAreas }); } catch (e) { }
            });
            MessageToast.show("Access areas updated successfully.");
        },

        // DEDICATED ACCESS AREA TABLE DELETE LOGIC
        _getSelectedAccessAreaContexts: function () {
            var oView = (this.base && typeof this.base.getView === "function") ? this.base.getView() : this.getView();
            if (!oView) return [];

            var aTables = oView.findAggregatedObjects(true, function (oControl) { return (oControl && oControl.isA("sap.m.Table")); });
            for (var i = 0; i < aTables.length; i++) {
                var oTable = aTables[i];
                var oBinding = null;
                try { oBinding = oTable.getBinding("items"); } catch (e) { }
                if (!oBinding) continue;
                var sPath = "";
                try { sPath = String(oBinding.getPath() || "").toLowerCase(); } catch (e) { }
                var sTableId = String(typeof oTable.getId === "function" ? oTable.getId() : "").toLowerCase();

                if (sPath.indexOf("_items") === -1) continue;
                if (sPath.indexOf("existing") !== -1 || sTableId.indexOf("existing") !== -1 || sTableId.indexOf("dialog") !== -1 || sTableId.indexOf("popover") !== -1) continue;

                var aSelectedItems = typeof oTable.getSelectedItems === "function" ? oTable.getSelectedItems() : [];
                var aContexts = aSelectedItems.map(function (oItem) { return oItem.getBindingContext(); }).filter(Boolean);
                if (aContexts.length > 0) return aContexts;
            }
            return [];
        },

        _getAreaDeleteInfoFromContext: function (oContext) {
            if (!oContext) return { code: "UNKNOWN", name: "Selected Access Area" };
            var mDraftAreaMap = this._mDraftAreaMap || {};
            var sContextPath = "";
            try { if (typeof oContext.getPath === "function") sContextPath = String(oContext.getPath() || ""); } catch (e) { }

            var aDraftCodes = Object.keys(mDraftAreaMap);
            for (var i = 0; i < aDraftCodes.length; i++) {
                var sDraftCode = aDraftCodes[i];
                var oDraftEntry = mDraftAreaMap[sDraftCode];
                if (!oDraftEntry) continue;
                var bSameContext = oDraftEntry.context === oContext;
                var bSamePath = false;
                if (!bSameContext && sContextPath && oDraftEntry.context && typeof oDraftEntry.context.getPath === "function") {
                    try { bSamePath = String(oDraftEntry.context.getPath() || "") === sContextPath; } catch (e) { }
                }
                if (bSameContext || bSamePath) return { code: String(oDraftEntry.code || sDraftCode || "").trim(), name: String(oDraftEntry.name || "").trim() };
            }

            try {
                var sCode = oContext.getProperty("AreaCode");
                var sName = oContext.getProperty("AccessArea") || oContext.getProperty("AreaName") || oContext.getProperty("AreaDesc");
                if (sCode || sName) return { code: sCode ? String(sCode).trim() : "UNKNOWN", name: sName ? String(sName).trim() : "Selected Access Area" };
            } catch (e) { }

            return { code: "UNKNOWN", name: "Selected Access Area" };
        },

        _configureAccessAreaDeleteDialog: function (oDialog, aContextsOverride) {
            var oExtension = this;
            if (!oDialog) return false;

            var aContexts = Array.isArray(aContextsOverride) && aContextsOverride.length > 0 ? aContextsOverride : this._getSelectedAccessAreaContexts();
            if (!aContexts || aContexts.length === 0) return false;

            var aAreas = [];
            var aValidContexts = [];
            aContexts.forEach(function (oContext) {
                var oInfo = oExtension._getAreaDeleteInfoFromContext(oContext);
                aAreas.push({ code: oInfo.code, name: oInfo.name });
                aValidContexts.push(oContext);
            });

            var mUniqueAreas = {};
            aAreas.forEach(function (oArea, iIndex) {
                if (!mUniqueAreas[oArea.code]) mUniqueAreas[oArea.code] = { area: oArea, context: aValidContexts[iIndex] };
            });

            var aUniqueEntries = Object.keys(mUniqueAreas).map(function (sCode) { return mUniqueAreas[sCode]; });
            aAreas = aUniqueEntries.map(function (oEntry) { return oEntry.area; });
            aValidContexts = aUniqueEntries.map(function (oEntry) { return oEntry.context; });

            var bMultiple = aAreas.length > 1;
            var sTitle = bMultiple ? "Remove Access Areas" : "Remove Access Area";
            var sAreaText = aAreas.map(function (oArea) {
                return "• " + (oArea.name && oArea.name !== "Selected Access Area" ? oArea.name : (oArea.code !== "UNKNOWN" ? oArea.code : "Selected Access Area"));
            }).join("\n");
            var sMessage = (bMultiple ? "The following access areas will be removed:\n\n" : "The following access area will be removed:\n\n") + sAreaText + "\n\nDo you want to continue?";

            oDialog.setTitle(sTitle);
            var aTexts = oDialog.findAggregatedObjects(true, function (oControl) { return (oControl.isA("sap.m.Text") || oControl.isA("sap.m.FormattedText")); });
            var bTextReplaced = false;
            aTexts.forEach(function (oText) {
                var sText = typeof oText.getText === "function" ? String(oText.getText() || "").trim() : "";
                if (!bTextReplaced && sText.length > 0) { oText.setText(sMessage); bTextReplaced = true; }
            });

            var aButtons = typeof oDialog.getButtons === "function" ? oDialog.getButtons() : [];
            if (!aButtons || aButtons.length === 0) return false;

            var oYesButton = null, oNoButton = null;
            aButtons.forEach(function (oButton) {
                var sBtnText = oButton.getText() || "";
                if (!oYesButton && (sBtnText === "Delete" || sBtnText === "Yes" || sBtnText === "OK")) oYesButton = oButton;
                if (!oNoButton && (sBtnText === "Cancel" || sBtnText === "No")) oNoButton = oButton;
            });
            if (!oYesButton || !oNoButton) return false;

            var aOriginalYesHandlers = (oYesButton.mEventRegistry && oYesButton.mEventRegistry.press) ? oYesButton.mEventRegistry.press.slice() : [];
            var aOriginalNoHandlers = (oNoButton.mEventRegistry && oNoButton.mEventRegistry.press) ? oNoButton.mEventRegistry.press.slice() : [];

            aOriginalYesHandlers.forEach(function (oHandler) { oYesButton.detachPress(oHandler.fFunction, oHandler.oListener); });
            aOriginalNoHandlers.forEach(function (oHandler) { oNoButton.detachPress(oHandler.fFunction, oHandler.oListener); });

            oYesButton.setText("Yes");
            oNoButton.setText("No");

            var fnRestoreOriginalHandlers = function () {
                aOriginalYesHandlers.forEach(function (oHandler) { oYesButton.detachPress(oHandler.fFunction, oHandler.oListener); });
                aOriginalNoHandlers.forEach(function (oHandler) { oNoButton.detachPress(oHandler.fFunction, oHandler.oListener); });
                aOriginalYesHandlers.forEach(function (oHandler) { oYesButton.attachPress(oHandler.fFunction, oHandler.oListener); });
                aOriginalNoHandlers.forEach(function (oHandler) { oNoButton.attachPress(oHandler.fFunction, oHandler.oListener); });
            };

            oDialog.data("jhahAreaDeleteConfigured", true);

            if (oExtension._oAreaDeleteYesHandler) { try { oYesButton.detachPress(oExtension._oAreaDeleteYesHandler); } catch (e) { } oExtension._oAreaDeleteYesHandler = null; }
            if (oExtension._oAreaDeleteNoHandler) { try { oNoButton.detachPress(oExtension._oAreaDeleteNoHandler); } catch (e) { } oExtension._oAreaDeleteNoHandler = null; }

            oExtension._oAreaDeleteYesHandler = function () {
                fnRestoreOriginalHandlers();
                oExtension._removeSelectedAccessAreas(aValidContexts);
                try { oYesButton.detachPress(oExtension._oAreaDeleteYesHandler); oNoButton.detachPress(oExtension._oAreaDeleteNoHandler); } catch (e) { }
                oExtension._oAreaDeleteYesHandler = null; oExtension._oAreaDeleteNoHandler = null;
                oDialog.close();
            };
            oYesButton.attachPress(oExtension._oAreaDeleteYesHandler);

            oExtension._oAreaDeleteNoHandler = function () {
                fnRestoreOriginalHandlers();
                try { oYesButton.detachPress(oExtension._oAreaDeleteYesHandler); oNoButton.detachPress(oExtension._oAreaDeleteNoHandler); } catch (e) { }
                oExtension._oAreaDeleteYesHandler = null; oExtension._oAreaDeleteNoHandler = null;
                oDialog.close();
            };
            oNoButton.attachPress(oExtension._oAreaDeleteNoHandler);

            return true;
        },

        _onAccessAreaDelete: function () {
            var oExtension = this;
            var aContexts = oExtension._aPendingAccessAreaDeleteContexts || oExtension._getSelectedAccessAreaContexts();
            if (!Array.isArray(aContexts) || aContexts.length === 0) {
                oExtension._bAreaDeleteDialogOpening = false; oExtension._aPendingAccessAreaDeleteContexts = null; return;
            }

            var oView = (oExtension.base && typeof oExtension.base.getView === "function") ? oExtension.base.getView() : oExtension.getView();
            var aSelectedRows = [];

            if (oView) {
                var aTables = oView.findAggregatedObjects(true, function (oControl) { return (oControl && oControl.isA("sap.m.Table")); }) || [];
                for (var i = 0; i < aTables.length; i++) {
                    var oTable = aTables[i];
                    var oBinding = null;
                    try { oBinding = oTable.getBinding("items"); } catch (e) { }
                    if (!oBinding) continue;
                    var sPath = "";
                    try { sPath = String(oBinding.getPath() || "").toLowerCase(); } catch (e) { }
                    var sTableId = String(typeof oTable.getId === "function" ? oTable.getId() : "").toLowerCase();
                    if (sPath.indexOf("_items") === -1 || sPath.indexOf("existing") !== -1 || sTableId.indexOf("existing") !== -1 || sTableId.indexOf("dialog") !== -1 || sTableId.indexOf("popover") !== -1) continue;
                    if (typeof oTable.getSelectedItems !== "function") continue;
                    aSelectedRows = oTable.getSelectedItems() || [];
                    if (aSelectedRows.length > 0) break;
                }
            }

            var aEntries = [];
            aContexts.forEach(function (oContext, iIndex) {
                if (!oContext) return;
                var sCode = "", sName = "";
                var oInfo = oExtension._getAreaDeleteInfoFromContext(oContext);
                if (oInfo && oInfo.code && oInfo.code !== "UNKNOWN") { sCode = String(oInfo.code || "").trim(); sName = String(oInfo.name || "").trim(); }

                if (!sCode || !sName) {
                    try {
                        var oData = oContext.getObject() || {};
                        if (!sCode) sCode = String(oData.AreaCode || "").trim();
                        if (!sName) sName = String(oData.AccessArea || oData.AreaName || oData.AreaDesc || "").trim();
                    } catch (e) { }
                }

                if ((!sCode || !sName) && aSelectedRows.length > 0) {
                    var oMatchedRow = null;
                    aSelectedRows.some(function (oRow) {
                        var oRowContext = null;
                        try { oRowContext = oRow.getBindingContext(); } catch (e) { }
                        if (!oRowContext) return false;
                        if (oRowContext === oContext) { oMatchedRow = oRow; return true; }
                        try {
                            if (typeof oRowContext.getPath === "function" && typeof oContext.getPath === "function" && String(oRowContext.getPath() || "") === String(oContext.getPath() || "")) {
                                oMatchedRow = oRow; return true;
                            }
                        } catch (e) { }
                        return false;
                    });
                    if (oMatchedRow) {
                        var aCells = typeof oMatchedRow.getCells === "function" ? oMatchedRow.getCells() || [] : [];
                        aCells.some(function (oCell) {
                            if (!oCell || typeof oCell.getBindingPath !== "function") return false;
                            var sCellPath = String(oCell.getBindingPath("text") || oCell.getBindingPath("title") || oCell.getBindingPath("value") || "").toLowerCase();
                            if (sCellPath.indexOf("accessarea") !== -1 || sCellPath.indexOf("areaname") !== -1 || sCellPath.indexOf("areadesc") !== -1) {
                                var sText = typeof oCell.getText === "function" ? String(oCell.getText() || "").trim() : "";
                                if (sText) { sName = sText; return true; }
                            }
                            return false;
                        });
                        if (!sName) {
                            aCells.some(function (oCell) {
                                if (!oCell) return false;
                                var sText = "";
                                if (typeof oCell.getText === "function") sText = String(oCell.getText() || "").trim();
                                if (!sText && typeof oCell.getTitle === "function") sText = String(oCell.getTitle() || "").trim();
                                if (sText && sText.toLowerCase() !== "area") { sName = sText; return true; }
                                return false;
                            });
                        }
                    }
                }

                if (!sName) sName = sCode || ("Selected Access Area " + (iIndex + 1));
                var sUniqueKey = sCode;
                if (!sUniqueKey) { try { sUniqueKey = typeof oContext.getPath === "function" ? String(oContext.getPath() || "") : ""; } catch (e) { sUniqueKey = ""; } }
                if (!sUniqueKey) sUniqueKey = "context-" + iIndex;
                aEntries.push({ context: oContext, code: sCode, name: sName, uniqueKey: sUniqueKey });
            });

            var mSeen = {};
            var aUniqueEntries = [];
            aEntries.forEach(function (oEntry) {
                if (oEntry.code && mSeen["CODE:" + oEntry.code]) return;
                var sKey = oEntry.code ? "CODE:" + oEntry.code : "CTX:" + oEntry.uniqueKey;
                if (mSeen[sKey]) return;
                mSeen[sKey] = true;
                aUniqueEntries.push(oEntry);
            });

            if (aUniqueEntries.length === 0) {
                oExtension._bAreaDeleteDialogOpening = false; oExtension._aPendingAccessAreaDeleteContexts = null; return;
            }

            var aDeleteContexts = aUniqueEntries.map(function (oEntry) { return oEntry.context; });
            var bMultiple = aUniqueEntries.length > 1;
            var sTitle = bMultiple ? "Remove Access Areas" : "Remove Access Area";
            var sAreaText = aUniqueEntries.map(function (oEntry) { return "• " + oEntry.name; }).join("\n");
            var sMessage = (bMultiple ? "The following access areas will be removed:\n\n" : "The following access area will be removed:\n\n") + sAreaText + "\n\nDo you want to continue?";

            MessageBox.confirm(sMessage, {
                title: sTitle, actions: [MessageBox.Action.YES, MessageBox.Action.NO], emphasizedAction: MessageBox.Action.YES,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.YES) {
                        oExtension._removeSelectedAccessAreas(aDeleteContexts);
                    } else {
                        oExtension._bAreaDeleteDialogOpening = false;
                        oExtension._aPendingAccessAreaDeleteContexts = null;
                    }
                }
            });
        },

        _removeSelectedAccessAreas: function (aContexts) {
            var oExtension = this;
            if (!Array.isArray(aContexts) || aContexts.length === 0) {
                oExtension._bAreaDeleteDialogOpening = false; oExtension._bSuppressStandardDraftDelete = false; return;
            }

            var aDeletePromises = [];
            aContexts.forEach(function (oContext) {
                if (!oContext || typeof oContext.delete !== "function") return;
                try {
                    var oDeletePromise = oContext.delete("$auto");
                    if (oDeletePromise && typeof oDeletePromise.then === "function") aDeletePromises.push(oDeletePromise);
                } catch (oError) { aDeletePromises.push(Promise.reject(oError)); }
            });

            if (aDeletePromises.length === 0) {
                oExtension._bAreaDeleteDialogOpening = false; oExtension._bSuppressStandardDraftDelete = false; return;
            }

            Promise.all(aDeletePromises).then(function () {
                oExtension._bAreaDeleteDialogOpening = false; oExtension._bSuppressStandardDraftDelete = false;
                MessageToast.show(aContexts.length === 1 ? "Access area removed successfully." : "Access areas removed successfully.");
            }).catch(function (oError) {
                oExtension._bAreaDeleteDialogOpening = false; oExtension._bSuppressStandardDraftDelete = false;
                MessageToast.show("Some access areas could not be removed.");
            });
        },

        // CORE UI LOGIC
        _hideEditingStatusFilter: function () {
            var oExtension = this;
            if (this._pEditingStatusReset) clearInterval(this._pEditingStatusReset);
            var iAttempts = 0; var iMaxAttempts = 100;

            this._pEditingStatusReset = setInterval(function () {
                iAttempts++; var bDone = false;
                try {
                    var aBars = sap.ui.core.Element.registry.filter(function (oControl) { return (oControl && oControl.isA && (oControl.isA("sap.ui.mdc.FilterBar") || oControl.isA("sap.ui.comp.smartfilterbar.SmartFilterBar"))); });
                    for (var i = 0; i < aBars.length; i++) {
                        var oFilterBar = aBars[i];
                        if (oFilterBar._oP13nFilter && typeof oFilterBar._oP13nFilter.getP13nData === "function") {
                            var oP13nData = oFilterBar._oP13nFilter.getP13nData();
                            if (oP13nData && Array.isArray(oP13nData.items)) {
                                var oEditState = oP13nData.items.find(function (oItem) { return (oItem.key === "$editState" || oItem.name === "$editState"); });
                                if (oEditState) {
                                    oEditState.visible = false;
                                    try {
                                        if (typeof oFilterBar.setFilterConditions === "function") {
                                            var mConditions = oFilterBar.getFilterConditions() || {};
                                            if (mConditions["$editState"]) { delete mConditions["$editState"]; oFilterBar.setFilterConditions(mConditions); }
                                        }
                                        oFilterBar._oP13nFilter.setP13nData(oP13nData);
                                        bDone = true;
                                    } catch (e) { }
                                }
                            }
                        }
                        if (typeof oFilterBar.getFilterItems === "function") {
                            var aItems = oFilterBar.getFilterItems() || [];
                            aItems.forEach(function (oItem) {
                                var sId = String(oItem.getId() || "");
                                if (sId.indexOf("editState") !== -1 || sId.indexOf("EditingStatus") !== -1 || sId.indexOf("DraftEditingStatus") !== -1) {
                                    try { oItem.setVisible(false); bDone = true; } catch (e) { }
                                }
                            });
                        }
                    }
                } catch (oError) { }

                if (bDone || iAttempts >= iMaxAttempts) { clearInterval(oExtension._pEditingStatusReset); oExtension._pEditingStatusReset = null; }
            }, 200);
        },

        // ============================================================
        // 1. EMPLOYEE DETAILS LIVE FETCH (OData V4 Safe Filter)
        // ============================================================
        _fetchEmployeeDetails: function (sPayrollNum) {
            var oView = this.base.getView();
            var oAppModel = oView.getModel();
            var oEmployeeModel = oView.getModel("employeeInfo");
            if (!oAppModel || !oEmployeeModel) return;

            var sCleanId = (sPayrollNum || "").trim();
            if (!sCleanId || sCleanId === "0" || sCleanId === "") {
                if (this._sLatestRequestedId !== "0") {
                    this._sLatestRequestedId = "0";
                    oEmployeeModel.setData({ isVisible: false }); oEmployeeModel.refresh(true);
                }
                return;
            }

            if (this._sLatestRequestedId === sCleanId) return;
            this._sLatestRequestedId = sCleanId;

            var oListBinding = oAppModel.bindList("/EmployeeDetails", null, null, [new sap.ui.model.Filter("Pernr", sap.ui.model.FilterOperator.EQ, sCleanId)], { $$groupId: "$direct" });
            oListBinding.requestContexts(0, 1).then(function (aContexts) {
                if (this._sLatestRequestedId !== sCleanId) return;
                this._loadExistingAreas(oAppModel, sCleanId);
                if (aContexts && aContexts.length > 0) {
                    var oData = aContexts[0].getObject();
                    oEmployeeModel.setData(Object.assign({}, oData, { isVisible: true }));
                } else { oEmployeeModel.setData({ isVisible: false }); }
                oEmployeeModel.refresh(true);
            }.bind(this)).catch(function (oError) {
                if (this._sLatestRequestedId !== sCleanId) return;
                oEmployeeModel.setData({ isVisible: false }); oEmployeeModel.refresh(true);
            }.bind(this));
        },

        _onPayrollModelChanged: function (oEvent) {
            var sNewVal = oEvent.getSource().getValue();
            this._fetchEmployeeDetails(sNewVal);
        },

        _formatTime12h: function (sTime) {
            if (!sTime) return "";
            var aParts = String(sTime).split(":");
            var iHours = parseInt(aParts[0], 10);
            var sMins = aParts[1] || "00";
            var sAmPm = iHours >= 12 ? "PM" : "AM";
            iHours = iHours % 12; iHours = iHours ? iHours : 12;
            return iHours + ":" + sMins + " " + sAmPm;
        },

        _setSafeProperty: function (oContext, sKeyword, sValue, bOnlyIfNull) {
            if (!oContext) return;
            var oData = oContext.getObject() || {};
            var sExactKey = Object.keys(oData).find(function (k) { return k.toLowerCase().replace(/[^a-z0-9]/g, '') === sKeyword.toLowerCase().replace(/[^a-z0-9]/g, ''); });
            var sFinalKey = sExactKey || sKeyword;
            if (bOnlyIfNull) {
                var currentVal = oContext.getProperty(sFinalKey);
                if (currentVal !== null && currentVal !== undefined && currentVal !== "") return;
            }
            try {
                var oProm = oContext.setProperty(sFinalKey, sValue);
                if (oProm && typeof oProm.catch === "function") oProm.catch(function () { });
            } catch (e) { }
        },

        _updateRenewButtonState: function () {
            var oView = this.base.getView();
            var fnUpdate = function () {
                var bIsEligible = false;
                var oActiveIdModel = oView.getModel("activeIDModel");
                if (oActiveIdModel) {
                    var oData = oActiveIdModel.getData() || {};
                    if (oData.IdNumber && oData.IsExpiringSoon) bIsEligible = true;
                }
                var aButtons = oView.findAggregatedObjects(true, function (o) { return o.isA("sap.m.Button") && (o.getId && (o.getId().indexOf("Action::renewID") !== -1 || o.getId().indexOf("renewID") !== -1)); });
                aButtons.forEach(function (oBtn) { if (oBtn.getEnabled() !== bIsEligible) oBtn.setEnabled(bIsEligible); });
            };
            fnUpdate(); setTimeout(fnUpdate, 400); setTimeout(fnUpdate, 1200);
        },

_loadActiveIDAndFragment: function () {
            var oView = this.base.getView();
            if (!oView) return Promise.resolve();

            var sViewId = oView.getId();
            this._log("ActiveID [1/7]: Init called for View: " + sViewId);

            // 1. Check if we already created the fragment and saved it to the View
            var oExistingFragment = oView.data("_jhah_activeIdFragment");
            if (oExistingFragment) {
                this._log("ActiveID [2/7]: Fragment already exists in View data. Re-inserting and aborting load.");
                
                var aDynamicPages = oView.findAggregatedObjects(true, function (o) { return o.isA("sap.f.DynamicPage"); });
                if (aDynamicPages.length > 0 && !oView.isDestroyed()) {
                    this._insertIdCardToPage(oExistingFragment, aDynamicPages[0]);
                }
                return Promise.resolve();
            }

            // 2. Check if a load is already in progress
            var oPromise = oView.data("_jhah_activeIdPromise");
            if (oPromise) {
                this._log("ActiveID [2/7]: Load already in progress. Returning existing Promise.");
                return oPromise;
            }

            oPromise = this._doLoadActiveIDAndFragment(0).catch(function(oError) {
                this._log("ActiveID [ERROR]: Failed to load Active ID Fragment", oError);
                if (oView && !oView.isDestroyed() && !(oView.isDestroyStarted && oView.isDestroyStarted())) {
                    oView.data("_jhah_activeIdPromise", null);
                }
                throw oError;
            }.bind(this));

            oView.data("_jhah_activeIdPromise", oPromise);
            return oPromise;
        },

        _doLoadActiveIDAndFragment: async function (iRetryCount) {
            iRetryCount = iRetryCount || 0;
            var oView = this.base.getView();

            if (!oView || oView.isDestroyed() || (oView.isDestroyStarted && oView.isDestroyStarted())) {
                this._log("ActiveID [3/7]: View destroyed. Aborting.");
                return;
            }

            var aDynamicPages = oView.findAggregatedObjects(true, function (oControl) {
                return oControl.isA("sap.f.DynamicPage");
            });

            var oListReportPage = aDynamicPages.length > 0 ? aDynamicPages[0] : null;

            if (!oListReportPage || !oView.getModel()) {
                if (iRetryCount >= 20) {
                    this._log("ActiveID [3/7]: View or model not ready after 20 attempts. Aborting.");
                    return;
                }
                this._log("ActiveID [3/7]: View not ready, waiting 200ms... (Attempt " + iRetryCount + ")");
                await new Promise(function (resolve) { setTimeout(resolve, 200); });
                return this._doLoadActiveIDAndFragment(iRetryCount + 1);
            }

            // Re-check just in case it was built while waiting
            if (oView.data("_jhah_activeIdFragment")) {
                this._log("ActiveID [4/7]: Fragment created during wait. Aborting.");
                return;
            }

            this._log("ActiveID [4/7]: Triggering OData request to /activeID");
            var oBinding = oView.getModel().bindList("/activeID", null, null, null, { $$groupId: "$direct" });
            var aContexts = await oBinding.requestContexts(0, 1);

            if (oView.isDestroyed() || (oView.isDestroyStarted && oView.isDestroyStarted())) {
                this._log("ActiveID [5/7]: View destroyed during OData wait. Aborting.");
                return;
            }

            if (!aContexts || aContexts.length === 0) {
                this._log("ActiveID [5/7]: OData returned 0 rows. User has no ID. Aborting load.");
                return;
            }

            var oData = aContexts[0].getObject();
            this._log("ActiveID [5/7]: OData payload received", oData);

            // GHOST RECORD CHECK: Make absolutely sure the payload has a real ID Number
            if (!oData || !oData.IdNumber || String(oData.IdNumber).trim() === "") {
                this._log("ActiveID [5/7]: OData returned a blank/ghost record. User has no ID. Aborting load.");
                return;
            }

            if (oData.ExpiryDate) {
                var oExpiry = new Date(oData.ExpiryDate);
                var oToday = new Date();
                oExpiry.setHours(0, 0, 0, 0);
                oToday.setHours(0, 0, 0, 0);

                var iDays = Math.round((oExpiry - oToday) / (1000 * 60 * 60 * 24));

                oData.DaystoExpire = iDays;
                oData.IsExpiringSoon = iDays <= 30;

                if (iDays < 0) {
                    oData.StatusText = "EXPIRED"; oData.StatusState = "Error"; oData.DaystoExpireText = Math.abs(iDays) + " Days Ago"; oData.DaystoExpireClass = "zhrActiveIdValue zhrExpiringRed";
                } else if (iDays === 0) {
                    oData.StatusText = "EXPIRING TODAY"; oData.StatusState = "Error"; oData.DaystoExpireText = "0 Days"; oData.DaystoExpireClass = "zhrActiveIdValue zhrExpiringRed";
                } else if (iDays <= 30) {
                    oData.StatusText = "RENEWAL ELIGIBLE"; oData.StatusState = "Warning"; oData.DaystoExpireText = iDays + " Days"; oData.DaystoExpireClass = "zhrActiveIdValue";
                } else {
                    oData.StatusText = "ACTIVE"; oData.StatusState = "Success"; oData.DaystoExpireText = iDays + " Days"; oData.DaystoExpireClass = "zhrActiveIdValue";
                }
            }

            oView.setModel(new sap.ui.model.json.JSONModel(oData), "activeIDModel");
            this._updateRenewButtonState();

            if (oView.isDestroyed() || (oView.isDestroyStarted && oView.isDestroyStarted())) {
                return;
            }

            if (oView.data("_jhah_activeIdFragment")) {
                return;
            }

            var oFragment;
            try {
                // FORCE A UNIQUE ID: This completely bypasses the UI5 duplicate ID crash
                var sUniqueId = oView.getId() + "--myActiveIDCard--" + Date.now() + "-" + Math.floor(Math.random() * 1000);
                this._log("ActiveID [6/7]: Loading Fragment XML with guaranteed unique ID: " + sUniqueId);

                oFragment = await sap.ui.core.Fragment.load({
                    id: sUniqueId,
                    name: "com.jhah.zhrjhahsecid.ext.fragment.ActiveIdCard",
                    controller: this
                });
                this._log("ActiveID [7/7]: Fragment loaded successfully.");

            } catch (e) {
                this._log("ActiveID [ERROR]: Fragment.load crashed!", e);
                throw e;
            }

            if (oView.isDestroyed() || (oView.isDestroyStarted && oView.isDestroyStarted())) {
                return;
            }

            var oRoot = Array.isArray(oFragment) ? oFragment[0] : oFragment;
            
            // Cache the physical fragment on the View so it never loads again
            oView.data("_jhah_activeIdFragment", oRoot);

            this._insertIdCardToPage(oRoot, oListReportPage);
            this._log("ActiveID [DONE]: Inserted into page.");
        },
        // _loadActiveIDAndFragment: function () {
        //     if (this._oActiveIDLoadPromise) return this._oActiveIDLoadPromise;
        //     var oView = this.base.getView();
        //     var aDynamicPages = oView.findAggregatedObjects(true, function (o) { return o.isA("sap.f.DynamicPage"); });
        //     var oListReportPage = aDynamicPages.length > 0 ? aDynamicPages[0] : null;

        //     if (!oListReportPage || !oView.getModel()) {
        //         setTimeout(this._loadActiveIDAndFragment.bind(this), 200);
        //         return;
        //     }

        //     this._oActiveIDLoadPromise = new Promise(function (resolve, reject) {
        //         var sFragmentId = oView.getId() + "--myActiveIDCard";
        //         var oExisting = sap.ui.core.Element.registry.get(sFragmentId);
        //         if (oExisting) { this._insertIdCardToPage(oExisting, oListReportPage); resolve(); return; }

        //         var oBinding = oView.getModel().bindList("/activeID", null, null, null, { $$groupId: "$direct" });
        //         oBinding.requestContexts(0, 1).then(function (aContexts) {
        //             if (!aContexts || aContexts.length === 0) { resolve(); return; }
        //             var oData = aContexts[0].getObject();

        //             if (oData.ExpiryDate) {
        //                 var oExpiry = new Date(oData.ExpiryDate); var oToday = new Date();
        //                 oExpiry.setHours(0, 0, 0, 0); oToday.setHours(0, 0, 0, 0);
        //                 var iDays = Math.round((oExpiry - oToday) / (1000 * 60 * 60 * 24));
        //                 oData.DaystoExpire = iDays; oData.IsExpiringSoon = iDays <= 30;

        //                 if (iDays < 0) { oData.StatusText = "EXPIRED"; oData.StatusState = "Error"; oData.DaystoExpireText = Math.abs(iDays) + " Days Ago"; oData.DaystoExpireClass = "zhrActiveIdValue zhrExpiringRed"; }
        //                 else if (iDays === 0) { oData.StatusText = "EXPIRING TODAY"; oData.StatusState = "Error"; oData.DaystoExpireText = "0 Days"; oData.DaystoExpireClass = "zhrActiveIdValue zhrExpiringRed"; }
        //                 else if (iDays <= 30) { oData.StatusText = "RENEWAL ELIGIBLE"; oData.StatusState = "Warning"; oData.DaystoExpireText = iDays + " Days"; oData.DaystoExpireClass = "zhrActiveIdValue"; }
        //                 else { oData.StatusText = "ACTIVE"; oData.StatusState = "Success"; oData.DaystoExpireText = iDays + " Days"; oData.DaystoExpireClass = "zhrActiveIdValue"; }
        //             }

        //             var oActiveIdModel = new JSONModel(oData);
        //             oView.setModel(oActiveIdModel, "activeIDModel");
        //             this._updateRenewButtonState();

        //             Fragment.load({ id: oView.getId(), name: "com.jhah.zhrjhahsecid.ext.fragment.ActiveIdCard", controller: this }).then(function (oFragment) {
        //                 var oRoot = Array.isArray(oFragment) ? oFragment[0] : oFragment;
        //                 this._insertIdCardToPage(oRoot, oListReportPage);
        //                 resolve();
        //             }.bind(this));
        //         }.bind(this)).catch(function () { this._updateRenewButtonState(); resolve(); }.bind(this));
        //     }.bind(this));
        //     return this._oActiveIDLoadPromise;
        // },

        _insertIdCardToPage: function (oRoot, oListReportPage) {
            try {
                if (oListReportPage) {
                    var oHeader = typeof oListReportPage.getHeader === "function" ? oListReportPage.getHeader() : null;
                    if (oHeader) {
                        if (typeof oHeader.indexOfContent === "function" && oHeader.indexOfContent(oRoot) === -1) oHeader.insertContent(oRoot, 0);
                        else if (typeof oHeader.addContent === "function" && oHeader.indexOfContent(oRoot) === -1) oHeader.addContent(oRoot);
                    }
                }
            } catch (e) { }
        },

        _addAsteriskByBindingPath: function (sPathSegment, bMandatory, bIsEditMode) {
            var oView = this.base.getView();
            if (!oView) return;
            var bShow = !!bMandatory && !!bIsEditMode;
            var sNeedle = String(sPathSegment || "").toLowerCase();

            var fnMatchesField = function (oField) {
                if (!oField || typeof oField.getBindingPath !== "function") return false;
                var aProperties = ["value", "conditions", "selectedKey", "selected"];
                for (var i = 0; i < aProperties.length; i++) {
                    var sPath = "";
                    try { sPath = String(oField.getBindingPath(aProperties[i]) || "").toLowerCase(); } catch (e) { }
                    if (sPath && sPath.indexOf(sNeedle) !== -1) return true;
                }
                return false;
            };

            var fnApplyToLabel = function (oLabel) {
                if (!oLabel) return;
                var $label;
                try { $label = oLabel.$(); } catch (e) { return; }
                if (!$label || $label.length === 0) return;

                var $existing = $label.find(".customRedAsterisk");
                if (bShow) {
                    try { if (typeof oLabel.setRequired === "function") oLabel.setRequired(true); } catch (e) { }
                    if ($existing.length === 0) {
                        var sMarker = "<span class='customRedAsterisk' aria-hidden='true' style='color:#ee0000;font-weight:bold;margin-left:4px;'>*</span>";
                        var $inner = $label.find('span[id$="-inner"]');
                        if ($inner.length > 0) $inner.append(sMarker); else $label.append(sMarker);
                    }
                } else {
                    $existing.remove();
                    try { if (typeof oLabel.setRequired === "function") oLabel.setRequired(false); } catch (e) { }
                }
            };

            oView.findAggregatedObjects(true, function (oControl) { return oControl.isA("sap.ui.layout.form.FormElement"); }).forEach(function (oFE) {
                var aFields = typeof oFE.getFields === "function" ? oFE.getFields() : [];
                var bMatch = aFields.some(fnMatchesField);
                if (!bMatch) return;
                var oLabel = null;
                try { oLabel = typeof oFE.getLabelControl === "function" ? oFE.getLabelControl() : oFE.getLabel(); } catch (e) { }
                fnApplyToLabel(oLabel);
            });

            var mKnownLabels = { reqtype: ["Request Type"], payrollnum: ["Payroll Number"], locationid: ["ID Office Location", "Office Location"], comments: ["Employee Justification"] };
            var aLabels = oView.$().find("label");
            aLabels.each(function () {
                var $label = $(this);
                var sText = String($label.text() || "").trim();
                var bTextMatch = false;

                Object.keys(mKnownLabels).forEach(function (sKey) {
                    if (sKey === sNeedle) {
                        mKnownLabels[sKey].forEach(function (sKnownText) {
                            if (sText.toLowerCase().indexOf(sKnownText.toLowerCase()) !== -1) bTextMatch = true;
                        });
                    }
                });
                if (!bTextMatch) return;

                if (bShow) {
                    if ($label.find(".customRedAsterisk").length === 0) $label.append("<span class='customRedAsterisk' aria-hidden='true' style='color:#ee0000;font-weight:bold;margin-left:4px;'>*</span>");
                } else { $label.find(".customRedAsterisk").remove(); }
            });
        },

        _updateAreaRequirementUI: function (bIsACCS, bIsNewReq, bIsEditMode) {
            var oView = this.base.getView();
            if (!oView) return;

            var $titles = oView.$().find(".sapUxAPObjectPageSectionTitle, .sapUxAPObjectPageSubSectionHeaderTitle");
            $titles.each(function () {
                var $title = $(this);
                var sText = String($title.text() || "").trim();
                if (!/^Access Area Selection(?:\s*\(Optional\))?\s*\*?$/.test(sText)) return;

                $title.find(".jhahAreaRequiredMarker, .jhahOptionalText").remove();
                if (!bIsEditMode) return;
                if (bIsACCS) $title.append("<span class='jhahAreaRequiredMarker customRedAsterisk' aria-hidden='true' style='color:#ee0000;font-weight:bold;margin-left:4px;'>*</span>");
                else $title.append("<span class='jhahOptionalText' style='font-size:0.875rem;font-weight:normal;margin-left:8px;opacity:0.75;'>(Optional)</span>");
            });
        },

        _applyUIEnhancements: function () {
            var oExtension = this;
            var oView = this.base.getView();
            var $view = oView.$();

            if ($view.length === 0) {
                setTimeout(this._applyUIEnhancements.bind(this), 200);
                return;
            }

            // Always enforce tab authorizations in the loop to prevent V4 rendering resets
            if (window._jhahCurrentMode) {
                this._applyTabAuthorizations(window._jhahCurrentMode);
            }

            oExtension._bHrStripAllowed = false;
            oExtension._setHrStripVisibility();
            oExtension._attachRequestTypeChangeHandler(oView);

            var domView = $view[0];
            if (!domView._jhahEventCapturerInstalled) {
                domView.addEventListener("pointerdown", function (e) {
                    var $btn = $(e.target).closest(".sapMBtn");
                    if ($btn.length > 0) {
                        var oBtn = Element.closestTo($btn[0]);
                        if (oBtn) {
                            var sId = String(oBtn.getId() || "");
                            var sText = typeof oBtn.getText === "function" ? String(oBtn.getText() || "").trim() : "";
                            var bIsDeleteButton = (sId.indexOf("StandardAction::Delete") !== -1 || sText.toUpperCase() === "DELETE");

                            if (bIsDeleteButton) {
                                var oBtnDom = oBtn.getDomRef && oBtn.getDomRef();
                                var bIsAccessAreaDelete = false;

                                if (oBtnDom) {
                                    var oButtonSection = $(oBtnDom).closest(".sapUxAPObjectPageSubSection, .sapUxAPObjectPageSection")[0];
                                    if (oButtonSection) {
                                        var aAreaTables = oView.findAggregatedObjects(true, function (oControl) { return (oControl && (oControl.isA("sap.m.Table") || oControl.isA("sap.ui.table.Table"))); });
                                        bIsAccessAreaDelete = aAreaTables.some(function (oTable) {
                                            var oBinding = null;
                                            try { oBinding = oTable.getBinding("items") || oTable.getBinding("rows"); } catch (e) { return false; }
                                            if (!oBinding) return false;
                                            var sBindingPath = "";
                                            try { sBindingPath = String(oBinding.getPath() || "").toLowerCase(); } catch (e) { return false; }
                                            if (sBindingPath.indexOf("_items") === -1) return false;
                                            var oTableDom = oTable.getDomRef && oTable.getDomRef();
                                            if (!oTableDom) return false;
                                            return (oButtonSection.contains(oTableDom) || oTableDom.contains(oBtnDom));
                                        });
                                    }
                                }

                                if (!bIsAccessAreaDelete) {
                                    var oParent = oBtn;
                                    while (oParent && typeof oParent.getParent === "function") {
                                        oParent = oParent.getParent();
                                        if (!oParent) break;
                                        var oParentBinding = null;
                                        try { oParentBinding = oParent.getBinding("items") || oParent.getBinding("rows"); } catch (e) { oParentBinding = null; }
                                        if (oParentBinding) {
                                            var sParentPath = "";
                                            try { sParentPath = String(oParentBinding.getPath() || "").toLowerCase(); } catch (e) { sParentPath = ""; }
                                            if (sParentPath.indexOf("_items") !== -1) { bIsAccessAreaDelete = true; break; }
                                        }
                                    }
                                }

                                if (!bIsAccessAreaDelete && sId.indexOf("_items") !== -1) bIsAccessAreaDelete = true;

                                if (bIsAccessAreaDelete) {
                                    var aSelectedAreaContexts = oExtension._getSelectedAccessAreaContexts();
                                    if (!aSelectedAreaContexts || aSelectedAreaContexts.length === 0) return;
                                    if (oExtension._bAreaDeleteDialogOpening) return;
                                    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                                    oExtension._aPendingAccessAreaDeleteContexts = aSelectedAreaContexts.slice();
                                    oExtension._bAreaDeleteDialogOpening = true;
                                    oExtension._onAccessAreaDelete();
                                    return;
                                }

                                oExtension._bHeaderDeletePending = true;
                                return;
                            }

                            if (sId.indexOf("Action::SelectAreas") !== -1 || sText.indexOf("Select Access Areas") !== -1 || sText.indexOf("Select Areas") !== -1) {
                                e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
                                oExtension.openAreaSelectionDialog();
                                return;
                            }
                        }
                    }
                }, true);
                domView._jhahEventCapturerInstalled = true;
            }

            if (!$view.data("inputRestrictorsAttached")) {
                $view.on("input change focusout", "input", function (oEvent) {
                    var oInputControl = Element.closestTo(oEvent.target);
                    if (!oInputControl || typeof oInputControl.getBindingPath !== "function") return;
                    var sPath = (oInputControl.getBindingPath("value") || oInputControl.getBindingPath("selectedKey") || "").toLowerCase();
                    if (!sPath) return;

                    if (sPath.indexOf("payrollnum") !== -1 || sPath.indexOf("pernr") !== -1) {
                        var sVal = oEvent.target.value;
                        var bHasLetters = /\D/.test(sVal);
                        var sClean = sVal.replace(/\D/g, '');
                        if (sClean.length > 8) sClean = sClean.substring(0, 8);

                        if (oEvent.type === "input" && sVal !== sClean) { oEvent.target.value = sClean; oInputControl.setValue(sClean); }

                        if (typeof oInputControl.setValueState === "function") {
                            if (oEvent.type === "input" && bHasLetters) {
                                oInputControl.setValueState("Error"); oInputControl.setValueStateText("Please type numbers only for the Payroll Number.");
                                setTimeout(function () { if (!oInputControl.bIsDestroyed) { oInputControl.setValueState("None"); } }, 3500);
                            } else if ((oEvent.type === "change" || oEvent.type === "focusout") && sClean.length > 0 && sClean.length !== 8) {
                                oInputControl.setValueState("Error"); oInputControl.setValueStateText("The Payroll Number must be exactly 8 digits long.");
                            } else if (sClean.length === 8 || sClean.length === 0) {
                                oInputControl.setValueState("None");
                            }
                        }
                    }
                });
                $view.data("inputRestrictorsAttached", true);
            }

            if (!$view.data("dynamicFeaturesAttached")) {
                setInterval(function () {
                    try {
                        var aDynamicPages = oView.findAggregatedObjects(true, function (o) { return o.isA("sap.f.DynamicPage"); });
                        var aObjectPages = oView.findAggregatedObjects(true, function (o) { return o.isA("sap.uxap.ObjectPageLayout"); });
                        var bIsObjectPage = aObjectPages.length > 0;
                        var bIsListReport = aDynamicPages.length > 0 && !bIsObjectPage;

// ============================================================
// [JHAH] DYNAMIC TAB FILTER LISTENER
// Covers all edge cases: Hides filter completely for Employees.
// For Admin/HR, forces "Yes" on Admin tab and "Empty" on Emp tab.
// ============================================================
if (bIsListReport && !oView.__jhahTabFilterAttached) {
    var aIconTabBars = oView.findAggregatedObjects(true, function (o) {
        return o.isA("sap.m.IconTabBar") || o.isA("sap.m.SegmentedButton");
    });

    if (aIconTabBars.length > 0) {
        var oIconTabBar = aIconTabBars[0];
        oExtension._log("Tab control found! ID: " + oIconTabBar.getId());
        
        var fnApplyTabFilter = function(sTabKey, bIsInitialLoad) {
            var bIsEmployeeRole = document.body.classList.contains("employeeMode");

            // -------------------------------------------------------------
            // SCENARIO 1: EMPLOYEE ROLE
            // The backend handles the default value. We just need to hide 
            // the filter from the screen completely and trigger the load.
            // -------------------------------------------------------------
            if (bIsEmployeeRole) {
                oExtension._log("Employee Mode active. Hiding 'Show Only Action Items' filter entirely.");
                setTimeout(function () {
                    var aFilterBars = oView.findAggregatedObjects(true, function (o) {
                        return o.isA("sap.ui.mdc.FilterBar") || o.isA("sap.ui.comp.smartfilterbar.SmartFilterBar");
                    });
                    if (aFilterBars.length === 0) return;
                    var oFilterBar = aFilterBars[0];
                    
                    // Locate and hide the IsActionItem field specifically
                    var aFilterItems = typeof oFilterBar.getFilterItems === "function" ? oFilterBar.getFilterItems() : [];
                    aFilterItems.forEach(function(f) {
                        var sPath = typeof f.getFieldPath === "function" ? f.getFieldPath() : "";
                        var sId = typeof f.getId === "function" ? f.getId() : "";
                        if (sPath === "IsActionItem" || sId.indexOf("IsActionItem") !== -1) {
                            if (typeof f.setVisible === "function") f.setVisible(false);
                            
                            // Safe CSS override just for this specific field's layout container
                            var $wrapper = f.$().closest("[class*='FilterBarItem'], [class*='AFLLayoutItem'], [class*='sapUiLayoutColumn'], [class*='FilterBarBaseItem']");
                            if ($wrapper.length > 0) {
                                $wrapper.attr("style", "display: none !important; width: 0px !important; margin: 0px !important; padding: 0px !important; overflow: hidden !important; visibility: hidden !important;");
                            }
                        }
                    });

                    // Trigger the search on first load to bypass Fiori variant laziness
                    if (bIsInitialLoad && !oView.__jhahInitialLoadFired) {
                        oView.__jhahInitialLoadFired = true;
                        
                        // Give Fiori's MDC state machine 250ms to digest the UI changes before searching
                        setTimeout(function() {
                            try {
                                if (typeof oFilterBar.triggerSearch === "function") oFilterBar.triggerSearch();
                                else if (typeof oFilterBar.search === "function") oFilterBar.search();
                            } catch (e) { oExtension._log("Error triggering automatic search", e); }
                        }, 250);
                    }
                }, 400);

                return; // EXIT EARLY: Do not run the value-forcing logic below
            }


            // -------------------------------------------------------------
            // SCENARIO 2: ADMIN / HR ROLE
            // Admin can see both tabs. Force "Yes" on Admin, Empty on Emp.
            // -------------------------------------------------------------
            var sTargetKey = String(sTabKey).toUpperCase();
            var bIsMyRequests = (sTargetKey.indexOf("EMPTAB") !== -1);
            oExtension._log("Admin/HR Mode. Is 'My Requests' Tab? " + bIsMyRequests);
            
            setTimeout(function () {
                var aFilterBars = oView.findAggregatedObjects(true, function (o) {
                    return o.isA("sap.ui.mdc.FilterBar") || o.isA("sap.ui.comp.smartfilterbar.SmartFilterBar");
                });

                if (aFilterBars.length === 0) return;
                var oFilterBar = aFilterBars[0];

                var aFilterItems = typeof oFilterBar.getFilterItems === "function" ? oFilterBar.getFilterItems() : [];
                var oActionField = null;

                for (var i = 0; i < aFilterItems.length; i++) {
                    var f = aFilterItems[i];
                    var sPath = typeof f.getFieldPath === "function" ? f.getFieldPath() : "";
                    var sId = typeof f.getId === "function" ? f.getId() : "";
                    if (sPath === "IsActionItem" || sId.indexOf("IsActionItem") !== -1) {
                        oActionField = f;
                        break;
                    }
                }

                if (!oActionField) return;

                var bChanged = false;
                var aCurrentConds = typeof oActionField.getConditions === "function" ? oActionField.getConditions() : [];

                if (bIsMyRequests) {
                    // Admin looking at "My Requests" tab: Clear MDC conditions
                    if (aCurrentConds && aCurrentConds.length > 0) {
                        oExtension._log("Clearing MDC conditions for My Requests tab.");
                        if (typeof oActionField.setConditions === "function") oActionField.setConditions([]);
                        bChanged = true;
                    }
                } else {
                    // Admin looking at "Employee Requests" tab: Force TRUE
                    var vTargetVal = true; 
                    if (typeof oFilterBar.getPropertyInfo === "function") {
                        var aPropInfo = oFilterBar.getPropertyInfo() || [];
                        var oProp = aPropInfo.find(function(p) { return p.name === "IsActionItem"; });
                        if (oProp && oProp.dataType && oProp.dataType.indexOf("String") !== -1) {
                            vTargetVal = "X";
                        }
                    }

                    var bNeedsUpdate = !aCurrentConds || aCurrentConds.length === 0 || aCurrentConds[0].values[0] !== vTargetVal;
                    if (bNeedsUpdate) {
                        oExtension._log("Forcing MDC condition to TRUE for Admin/HR tab.");
                        if (typeof oActionField.setConditions === "function") {
                            oActionField.setConditions([{ operator: "EQ", values: [vTargetVal], validated: "Validated" }]);
                        }
                        bChanged = true;
                    }
                }

                // Trigger Search
                var bIsFirstLoad = false;
                if (bIsInitialLoad && !oView.__jhahInitialLoadFired) {
                    bIsFirstLoad = true;
                    oView.__jhahInitialLoadFired = true;
                }

                if (bChanged || bIsFirstLoad) {
                    oExtension._log("Filter changed or First Load detected. Triggering list search.");
                    
                    // Give Fiori's internal MDC state machine 250ms to fully digest 
                    // the new conditions before we programmatically hit the 'Go' button.
                    setTimeout(function() {
                        try {
                            if (typeof oFilterBar.triggerSearch === "function") {
                                oFilterBar.triggerSearch(); // Fires for V4 MDC FilterBar
                            } else if (typeof oFilterBar.search === "function") {
                                oFilterBar.search(); // Fires for V2 SmartFilterBar fallback
                            }
                        } catch (e) {
                            oExtension._log("Error triggering automatic search", e);
                        }
                    }, 250);
                }

            }, 400); 
        };

        // Listen for user tab clicks
        if (typeof oIconTabBar.attachSelect === "function") {
            oIconTabBar.attachSelect(function(oEvent) {
                var sKey = oEvent.getParameter("key") || (oEvent.getParameter("item") ? oEvent.getParameter("item").getKey() : "");
                fnApplyTabFilter(sKey, false); 
            });
        }

        // Fire once on page load
        var sInitialKey = typeof oIconTabBar.getSelectedKey === "function" ? oIconTabBar.getSelectedKey() : "";
        fnApplyTabFilter(sInitialKey, true); 

        oView.__jhahTabFilterAttached = true;
    }
}
// ============================================================
// ============================================================
// if (bIsListReport && !oView.__jhahTabFilterAttached) {
//     var aIconTabBars = oView.findAggregatedObjects(true, function (o) {
//         return o.isA("sap.m.IconTabBar") || o.isA("sap.m.SegmentedButton");
//     });

//     if (aIconTabBars.length > 0) {
//         var oIconTabBar = aIconTabBars[0];
//         oExtension._log("Tab control found! ID: " + oIconTabBar.getId());
        
//         var fnApplyTabFilter = function(sTabKey, bIsInitialLoad) {
//             var bIsEmployeeRole = document.body.classList.contains("employeeMode");

//             // -------------------------------------------------------------
//             // SCENARIO 1: EMPLOYEE ROLE
//             // The backend handles the default value. We just need to hide 
//             // the filter from the screen completely and trigger the load.
//             // -------------------------------------------------------------
//             if (bIsEmployeeRole) {
//                 oExtension._log("Employee Mode active. Hiding 'Show Only Action Items' filter entirely.");
//                 setTimeout(function () {
//                     var aFilterBars = oView.findAggregatedObjects(true, function (o) {
//                         return o.isA("sap.ui.mdc.FilterBar") || o.isA("sap.ui.comp.smartfilterbar.SmartFilterBar");
//                     });
//                     if (aFilterBars.length === 0) return;
//                     var oFilterBar = aFilterBars[0];
                    
//                     // Locate and hide the IsActionItem field specifically
//                     var aFilterItems = typeof oFilterBar.getFilterItems === "function" ? oFilterBar.getFilterItems() : [];
//                     aFilterItems.forEach(function(f) {
//                         var sPath = typeof f.getFieldPath === "function" ? f.getFieldPath() : "";
//                         var sId = typeof f.getId === "function" ? f.getId() : "";
//                         if (sPath === "IsActionItem" || sId.indexOf("IsActionItem") !== -1) {
//                             if (typeof f.setVisible === "function") f.setVisible(false);
                            
//                             // Safe CSS override just for this specific field's layout container
//                             var $wrapper = f.$().closest("[class*='FilterBarItem'], [class*='AFLLayoutItem'], [class*='sapUiLayoutColumn'], [class*='FilterBarBaseItem']");
//                             if ($wrapper.length > 0) {
//                                 $wrapper.attr("style", "display: none !important; width: 0px !important; margin: 0px !important; padding: 0px !important; overflow: hidden !important; visibility: hidden !important;");
//                             }
//                         }
//                     });

//                     // Trigger the search on first load to bypass Fiori variant laziness
//                     if (bIsInitialLoad && !oView.__jhahInitialLoadFired) {
//                         oView.__jhahInitialLoadFired = true;
//                         if (typeof oFilterBar.triggerSearch === "function") oFilterBar.triggerSearch();
//                         else if (typeof oFilterBar.search === "function") oFilterBar.search();
//                     }
//                 }, 400);

//                 return; // EXIT EARLY: Do not run the value-forcing logic below
//             }


//             // -------------------------------------------------------------
//             // SCENARIO 2: ADMIN / HR ROLE
//             // Admin can see both tabs. Force "Yes" on Admin, Empty on Emp.
//             // -------------------------------------------------------------
//             var sTargetKey = String(sTabKey).toUpperCase();
//             var bIsMyRequests = (sTargetKey.indexOf("EMPTAB") !== -1);
//             oExtension._log("Admin/HR Mode. Is 'My Requests' Tab? " + bIsMyRequests);
            
//             setTimeout(function () {
//                 var aFilterBars = oView.findAggregatedObjects(true, function (o) {
//                     return o.isA("sap.ui.mdc.FilterBar") || o.isA("sap.ui.comp.smartfilterbar.SmartFilterBar");
//                 });

//                 if (aFilterBars.length === 0) return;
//                 var oFilterBar = aFilterBars[0];

//                 var aFilterItems = typeof oFilterBar.getFilterItems === "function" ? oFilterBar.getFilterItems() : [];
//                 var oActionField = null;

//                 for (var i = 0; i < aFilterItems.length; i++) {
//                     var f = aFilterItems[i];
//                     var sPath = typeof f.getFieldPath === "function" ? f.getFieldPath() : "";
//                     var sId = typeof f.getId === "function" ? f.getId() : "";
//                     if (sPath === "IsActionItem" || sId.indexOf("IsActionItem") !== -1) {
//                         oActionField = f;
//                         break;
//                     }
//                 }

//                 if (!oActionField) return;

//                 var bChanged = false;
//                 var aCurrentConds = typeof oActionField.getConditions === "function" ? oActionField.getConditions() : [];

//                 if (bIsMyRequests) {
//                     // Admin looking at "My Requests" tab: Clear MDC conditions
//                     if (aCurrentConds && aCurrentConds.length > 0) {
//                         oExtension._log("Clearing MDC conditions for My Requests tab.");
//                         if (typeof oActionField.setConditions === "function") oActionField.setConditions([]);
//                         bChanged = true;
//                     }
//                 } else {
//                     // Admin looking at "Employee Requests" tab: Force TRUE
//                     var vTargetVal = true; 
//                     if (typeof oFilterBar.getPropertyInfo === "function") {
//                         var aPropInfo = oFilterBar.getPropertyInfo() || [];
//                         var oProp = aPropInfo.find(function(p) { return p.name === "IsActionItem"; });
//                         if (oProp && oProp.dataType && oProp.dataType.indexOf("String") !== -1) {
//                             vTargetVal = "X";
//                         }
//                     }

//                     var bNeedsUpdate = !aCurrentConds || aCurrentConds.length === 0 || aCurrentConds[0].values[0] !== vTargetVal;
//                     if (bNeedsUpdate) {
//                         oExtension._log("Forcing MDC condition to TRUE for Admin/HR tab.");
//                         if (typeof oActionField.setConditions === "function") {
//                             oActionField.setConditions([{ operator: "EQ", values: [vTargetVal], validated: "Validated" }]);
//                         }
//                         bChanged = true;
//                     }
//                 }

//                 // Brute force visual Dropdown sync
//                 try {
//                     var aInnerControls = oActionField.findAggregatedObjects(true, function(o) {
//                         return o.isA("sap.m.Select") || o.isA("sap.m.ComboBox");
//                     });
                    
//                     aInnerControls.forEach(function(oInner) {
//                         if (typeof oInner.setSelectedKey === "function") {
//                             if (bIsMyRequests) oInner.setSelectedKey(""); 
//                             else oInner.setSelectedKey("true");
//                         }
//                     });
//                 } catch(e) {}

//                 // Trigger Search
//                 var bIsFirstLoad = false;
//                 if (bIsInitialLoad && !oView.__jhahInitialLoadFired) {
//                     bIsFirstLoad = true;
//                     oView.__jhahInitialLoadFired = true;
//                 }

//                 if (bChanged || bIsFirstLoad) {
//                     oExtension._log("Filter changed or First Load detected. Triggering list search.");
//                     if (typeof oFilterBar.triggerSearch === "function") oFilterBar.triggerSearch();
//                     else if (typeof oFilterBar.search === "function") oFilterBar.search();
//                 }

//             }, 400); 
//         };

//         // Listen for user tab clicks
//         if (typeof oIconTabBar.attachSelect === "function") {
//             oIconTabBar.attachSelect(function(oEvent) {
//                 var sKey = oEvent.getParameter("key") || (oEvent.getParameter("item") ? oEvent.getParameter("item").getKey() : "");
//                 fnApplyTabFilter(sKey, false); 
//             });
//         }

//         // Fire once on page load
//         var sInitialKey = typeof oIconTabBar.getSelectedKey === "function" ? oIconTabBar.getSelectedKey() : "";
//         fnApplyTabFilter(sInitialKey, true); 

//         oView.__jhahTabFilterAttached = true;
//     }
// }
// ============================================================
                        // ============================================================

                        var oContext = oView.getBindingContext();
                        var oEntityData = oContext ? oContext.getObject() || {} : {};

                        // ============================================================
                        // RECORD OWNER LOGIC
                        // ============================================================
                        if (bIsObjectPage && oContext) {
                            var bIsMine = false;
                            var bDataLoaded = false;

                            // 1. Is it a brand new draft? Implicitly yours.
                            if (bIsCreateMode) {
                                bIsMine = true;
                                bDataLoaded = true;
                            }
                            // 2. Data is loaded and we have the flag
                            else if (oEntityData.hasOwnProperty("IsMyRequest")) {
                                var vIsMyRequest = oEntityData.IsMyRequest;
                                bIsMine = (vIsMyRequest === true || vIsMyRequest === "X" || vIsMyRequest === "true");
                                bDataLoaded = true;
                            }

                            // Apply isolated CSS classes to the VIEW, not the body
                            if (bDataLoaded) {
                                oView.removeStyleClass("loadingOwnershipMode");
                                if (bIsMine) {
                                    if (!oView.hasStyleClass("myRequestMode")) {
                                        oView.removeStyleClass("otherRequestMode");
                                        oView.addStyleClass("myRequestMode");
                                        oExtension._log("OP Buttons: Applied 'myRequestMode'");
                                    }
                                } else {
                                    if (!oView.hasStyleClass("otherRequestMode")) {
                                        oView.removeStyleClass("myRequestMode");
                                        oView.addStyleClass("otherRequestMode");
                                        oExtension._log("OP Buttons: Applied 'otherRequestMode'");
                                    }
                                }
                            } else {
                                if (!oView.hasStyleClass("loadingOwnershipMode")) {
                                    oView.removeStyleClass("myRequestMode");
                                    oView.removeStyleClass("otherRequestMode");
                                    oView.addStyleClass("loadingOwnershipMode");
                                }
                            }
                        } else if (bIsListReport) {
                            oView.removeStyleClass("myRequestMode");
                            oView.removeStyleClass("otherRequestMode");
                            oView.removeStyleClass("loadingOwnershipMode");
                        }
                        // ============================================================

                        var $textNodes = $view.find(".sapMText");
                        $textNodes.each(function () {
                            var sTxt = $(this).text() || "";
                            if (sTxt.indexOf("filter active") !== -1 && sTxt.indexOf("Editing Status") !== -1) {
                                if (sTxt === "1 filter active: Editing Status") {
                                    if ($(this).css("display") !== "none") $(this).hide();
                                } else {
                                    var newTxt = sTxt.replace("Editing Status, ", "").replace(", Editing Status", "");
                                    var count = parseInt(newTxt.charAt(0)) - 1;
                                    var finalTxt = count + newTxt.substring(1);
                                    if (count === 1) finalTxt = finalTxt.replace("filters", "filter");
                                    if ($(this).text() !== finalTxt) $(this).text(finalTxt);
                                }
                            }
                        });

                        var sHiddenStyle = "display: none !important; width: 0px !important; margin: 0px !important; padding: 0px !important; position: absolute !important; pointer-events: none !important; border: none !important; min-width: 0px !important; max-width: 0px !important; flex: 0 0 0 !important; overflow: hidden !important; visibility: hidden !important;";

                        $view.find("label").each(function () {
                            var sLabelText = $(this).text() || "";
                            if (sLabelText.indexOf("Editing Status") !== -1 || sLabelText.indexOf("Editing status") !== -1) {
                                var $wrapper = $(this).closest("[class*='FilterBarItem'], [class*='AFLLayoutItem'], [class*='sapUiLayoutColumn'], [class*='FilterBarBaseItem']");
                                if ($wrapper.length > 0) $wrapper.attr("style", sHiddenStyle); else $(this).parent().attr("style", sHiddenStyle);
                            }
                        });

                        $view.find("[id*='DraftEditingStatus'], [id*='editState'], [id*='EditingStatus']").each(function () {
                            var $wrapper = $(this).closest("[class*='FilterBarItem'], [class*='AFLLayoutItem'], [class*='sapUiLayoutColumn'], [class*='FilterBarBaseItem']");
                            if ($wrapper.length > 0 && $wrapper.css("position") !== "absolute") $wrapper.attr("style", sHiddenStyle); else $(this).attr("style", sHiddenStyle);
                        });

                        oView.findAggregatedObjects(true, function (o) { return o.isA("sap.m.Table") || o.isA("sap.ui.table.Table"); }).forEach(function (t) {
                            var oBinding = t.getBinding("items") || t.getBinding("rows");
                            if (oBinding && String(oBinding.getPath()).indexOf("_items") !== -1) {
                                var aItems = typeof t.getItems === "function" ? t.getItems() : [];
                                aItems.forEach(function (oRow) {
                                    var aCells = typeof oRow.getCells === "function" ? oRow.getCells() : [];
                                    aCells.forEach(function (oCell) {
                                        if (oCell.isA && oCell.isA("sap.ui.comp.smartfield.SmartField") && oCell.getEditable()) oCell.setEditable(false);
                                        else if (typeof oCell.setEditable === "function" && oCell.getEditable()) oCell.setEditable(false);
                                    });
                                });
                            }
                        });


                        if (bIsListReport) {
                            var sFragmentId = oView.getId() + "--myActiveIDCard";
                            var oExisting = sap.ui.core.Element.registry.get(sFragmentId);
                            if (oExisting) {
                                var oHeaderLR = typeof aDynamicPages[0].getHeader === "function" ? aDynamicPages[0].getHeader() : null;
                                if (oHeaderLR && typeof oHeaderLR.indexOfContent === "function" && oHeaderLR.indexOfContent(oExisting) === -1) {
                                    oHeaderLR.insertContent(oExisting, 0);
                                }
                            }
                        }

                        var bIsCreateMode = false;
                        if (window.location.hash.indexOf("Create") !== -1 || (oEntityData.IsActiveEntity === false && oEntityData.HasActiveEntity === false && !oEntityData.RequestId)) {
                            bIsCreateMode = true;
                        }

                        var bIsEditMode = false;
                        if (window.location.hash.indexOf("IsActiveEntity=false") !== -1 || window.location.hash.indexOf("Create") !== -1 || (oEntityData.IsActiveEntity === false && oEntityData.HasActiveEntity === false)) {
                            bIsEditMode = true;
                        }

                        $view.find(".sapMBtn").each(function () {
                            var oBtn = Element.closestTo(this);
                            if (oBtn) {
                                var sId = String(oBtn.getId() || "");
                                var sText = String(oBtn.getText() || "").trim().toUpperCase();
                                var $btn = oBtn.$();

                                if (sId.indexOf("-settings") !== -1 || sId.indexOf("btnPersonalisation") !== -1) {
                                    if (oBtn.getVisible()) oBtn.setVisible(false);
                                    $(this).attr("style", sHiddenStyle);
                                }

                                var bIsTableAction = $btn.closest(".sapUiCompSmartTableToolbar, [id*='_items'], [id*='ExistingAreas']").length > 0;
                                var bIsFooterAction = $btn.closest("footer, .sapMFooter-CTX, .sapFDynamicPageFooter").length > 0;

                                // [JHAH] COMMENTED OUT AS PER REQUEST: CREATE/SUBMIT BUTTON DONE VIA CUSTOM UI/I18N
                                
                                if (sText === "CREATE" || sText === "CREATE SELF ID REQUEST" || sId.indexOf("StandardAction::Create") !== -1 || sId.indexOf("createButton") !== -1 || sId.indexOf("addEntry") !== -1) {
                                    if (bIsFooterAction) {
                                        if (oBtn.getText() !== "Submit") { try { oBtn.unbindProperty("text", true); } catch (e) { } oBtn.setText("Submit"); }
                                        $(this).find("bdi").each(function () { var t = $(this).text(); if (t === "Create" || t === "Create Self ID Request") $(this).text("Submit"); });
                                    } else if (bIsTableAction) {
                                        if (oBtn.getText() !== "Create") { try { oBtn.unbindProperty("text", true); } catch (e) { } oBtn.setText("Create"); }
                                        $(this).find("bdi").each(function () { if ($(this).text() === "Create Self ID Request") $(this).text("Create"); });
                                    } else if (bIsListReport) {
                                        if (oBtn.getText() !== "Create Self ID Request") { try { oBtn.unbindProperty("text", true); } catch (e) { } oBtn.setText("Create Self ID Request"); }
                                    }
                                }
                                

                                if (bIsListReport && sId.indexOf("StandardAction::Delete") !== -1) {
                                    if (oBtn.getVisible()) oBtn.setVisible(false);
                                    $(this).addClass("jhahHideElement").attr("style", sHiddenStyle);
                                }
                            }
                        });

                        if (bIsObjectPage) {
                            var sLiveReqType = oExtension._getLiveRequestType(oView, oEntityData).toUpperCase();
                            var bIsACCS = (sLiveReqType === "ACCS" || sLiveReqType === "ACCESS UPDATE");
                            var bIsNewReq = (sLiveReqType === "NEW" || sLiveReqType === "NEW HIRE");

                            var bEmployeeLoaded = false;
                            var oEmpModel = oView.getModel("employeeInfo");
                            if (oEmpModel && oEmpModel.getProperty("/isVisible") === true) bEmployeeLoaded = true;
                            else if (oEntityData.FullName && oEntityData.FullName.trim() !== "") bEmployeeLoaded = true;

                            // var bShowHrStrip = bIsCreateMode && !bIsNewReq && bEmployeeLoaded;
                            var bShowHrStrip =
                                bEmployeeLoaded &&
                                (
                                    oEntityData.IsMyRequest === true ||
                                    oEntityData.IsMyRequest === "X" ||
                                    oEntityData.IsMyRequest === "true"
                                );
                            oExtension._bHrStripAllowed = bShowHrStrip;
                            oExtension._setHrStripVisibility();

                            var $activeIdCard = $view.find(".zhrActiveIdWrapper");
                            $activeIdCard.addClass("jhahHideElement");
                            $activeIdCard.each(function () {
                                this.style.setProperty("display", "none", "important");
                                this.style.setProperty("opacity", "0", "important");
                            });

                            oExtension._addAsteriskByBindingPath("reqtype", true, bIsEditMode);
                            oExtension._addAsteriskByBindingPath("payrollnum", true, bIsEditMode);
                            oExtension._addAsteriskByBindingPath("locationid", true, bIsEditMode);
                            //oExtension._addAsteriskByBindingPath("comments", true, bIsEditMode);
                            var $justificationTitles = $view.find(
                                ".sapUxAPObjectPageSectionTitle, .sapUxAPObjectPageSubSectionHeaderTitle"
                            );

                            $justificationTitles.each(function () {
                                var $title = $(this);
                                var sText = String($title.text() || "").trim();

                                if (sText !== "Justification") return;

                                $title.find(".jhahJustificationRequiredMarker").remove();

                                if (bIsEditMode) {
                                    $title.append(
                                        "<span class='jhahJustificationRequiredMarker customRedAsterisk' " +
                                        "aria-hidden='true' " +
                                        "style='color:#ee0000;font-weight:bold;margin-left:4px;'>*</span>"
                                    );
                                }
                            });
                            oExtension._updateAreaRequirementUI(bIsACCS, false, bIsEditMode);

                            var aLockedNames = [];
                            Object.keys(oExtension._mExistingAreaMap || {}).forEach(function (sCode) {
                                if (oExtension._isAreaExistingAndLocked(sCode)) {
                                    var sName = oExtension._mExistingAreaMap[sCode][0].areaDesc || sCode;
                                    aLockedNames.push(sName + " 🔒");
                                }
                            });

                            if (aLockedNames.length > 0) {
                                var sStripText = "";
                                if (aLockedNames.length <= 3) sStripText = aLockedNames.join("&nbsp;&nbsp;&nbsp;");
                                else sStripText = aLockedNames.slice(0, 3).join("&nbsp;&nbsp;&nbsp;") + "&nbsp;&nbsp;&nbsp;+" + (aLockedNames.length - 3) + " more";

                                var sStripHtml =
                                    "<div class='jhahExistingAccessStrip' style='background-color:#f5f9fd; border:1px solid #d9d9d9; border-left: 4px solid #0a6ed1; border-radius:4px; padding:10px 16px; margin-top:8px; margin-bottom:12px; display:flex; align-items:center; box-shadow:0 1px 4px rgba(0,0,0,0.05);'>" +
                                    "<span style='font-size:1.1rem; margin-right:12px; color:#0a6ed1;'>&#9432;</span>" +
                                    "<span style='color:#32363a; font-size:0.875rem; line-height:1.4; font-weight:500;'>" +
                                    "You already have access to: <span style='font-weight:bold; color:#0f2d4a;'>" + sStripText + "</span>" +
                                    "</span></div>";

                                var $titles = $view.find(".sapUxAPObjectPageSectionTitle, .sapUxAPObjectPageSubSectionHeaderTitle");
                                $titles.each(function () {
                                    var $title = $(this);
                                    var sText = String($title.text() || "").trim();
                                    if (sText.indexOf("Access Area Selection") !== -1) {
                                        var $container = $title.closest(".sapUxAPObjectPageSection, .sapUxAPObjectPageSubSection");
                                        if ($container.find(".jhahExistingAccessStrip").length === 0) $title.after(sStripHtml);
                                        else $container.find(".jhahExistingAccessStrip").html("<span style='font-size:1.1rem; margin-right:12px; color:#0a6ed1;'>&#9432;</span><span style='color:#32363a; font-size:0.875rem; line-height:1.4; font-weight:500;'>You already have access to: <span style='font-weight:bold; color:#0f2d4a;'>" + sStripText + "</span></span>");
                                    }
                                });
                            } else {
                                $view.find(".jhahExistingAccessStrip").remove();
                            }

                            var oApptFromFE = null, oApptToFE = null, oApptDateFE = null;
                            oView.findAggregatedObjects(true, function (o) { return o.isA("sap.ui.layout.form.FormElement"); }).forEach(function (oFE) {
                                var aFlds = oFE.getFields();
                                aFlds.forEach(function (oFld) {
                                    if (typeof oFld.getBindingPath === "function") {
                                        var p = (oFld.getBindingPath("value") || oFld.getBindingPath("selectedKey") || "").toLowerCase();
                                        if (p.indexOf("appointmentfrom") !== -1 || p === "appoint_from_time") {
                                            oApptFromFE = oFE;
                                            if (!aFlds[0].hasStyleClass("jhahCustomTimeSlot") && !aFlds[0].hasStyleClass("jhahDisplayText")) oExtension._oNativeApptFromField = aFlds[0];
                                        }
                                        if (p.indexOf("appointmentto") !== -1 || p === "appoint_to_time") {
                                            oApptToFE = oFE;
                                            if (!aFlds[0].hasStyleClass("jhahNukeField")) oExtension._oNativeApptToField = aFlds[0];
                                        }
                                        if (p.indexOf("apptdate") !== -1 || p.indexOf("appointmentdate") !== -1) oApptDateFE = oFE;
                                    }
                                });
                            });

                            if (oContext && oApptFromFE && oApptDateFE) {
                                oExtension._oScheduleActionContext = oView.getBindingContext();
                                var sExistingFrom = oEntityData.AppointmentFrom || oEntityData.appoint_from_time;
                                var sExistingTo = oEntityData.AppointmentTo || oEntityData.appoint_to_time;
                                var sTimeKey = (oContext.getPath() || "") + "_" + (sExistingFrom || "empty");

                                if ($view.data("prefilledTimeKey") !== sTimeKey) {
                                    var oSlotModel = oExtension.base.getView().getModel("apptslots");
                                    if (oSlotModel && !oExtension._pSlotPopoverOpen) {
                                        if (sExistingFrom && sExistingTo && String(sExistingFrom).indexOf("00:00:00") === -1) oSlotModel.setProperty("/selectedLabel", oExtension._formatTime12h(sExistingFrom) + " - " + oExtension._formatTime12h(sExistingTo));
                                        else oSlotModel.setProperty("/selectedLabel", "");
                                        $view.data("prefilledTimeKey", sTimeKey);
                                    }
                                }

                                if (!oExtension._oScheduleDateDisplay || oExtension._oScheduleDateDisplay.bIsDestroyed) {
                                    oExtension._oScheduleDateDisplay = new Text({ text: { path: 'ApptDate', type: 'sap.ui.model.odata.type.Date', formatOptions: { style: 'medium' } }, width: "100%", textAlign: "Left" }).addStyleClass("jhahDisplayText jhahAppointmentDisplayValue");
                                    oExtension._oScheduleDateDisplay.setBindingContext(oExtension._oScheduleActionContext);
                                }

                                if (!oExtension._oScheduleDatePicker || oExtension._oScheduleDatePicker.bIsDestroyed) {
                                    oExtension._oScheduleDatePicker = new DatePicker({
                                        value: { path: 'ApptDate', type: 'sap.ui.model.odata.type.Date', formatOptions: { style: 'medium' } },
                                        minDate: "{apptslots>/minDate}", maxDate: "{apptslots>/maxDate}", placeholder: "Choose a date",
                                        change: function (oEvent) { oExtension._oScheduleActionContext = oView.getBindingContext(); oExtension.onAppointmentDateChange(oEvent, true); }
                                    }).addStyleClass("jhahCustomDateSlot");
                                    oExtension._oScheduleDatePicker.setBindingContext(oExtension._oScheduleActionContext);
                                }

                                var oExpectedDate = bIsEditMode ? oExtension._oScheduleDatePicker : oExtension._oScheduleDateDisplay;
                                if (oExpectedDate) {
                                    var bDateFound = false;
                                    oApptDateFE.getFields().forEach(function (oFld) {
                                        if (oFld === oExpectedDate) { bDateFound = true; oFld.setVisible(true); } else oFld.setVisible(false);
                                    });
                                    if (!bDateFound) oApptDateFE.addField(oExpectedDate);
                                }
                                oApptDateFE.setVisible(true);

                                if (!oExtension._oScheduleTimeDisplay || oExtension._oScheduleTimeDisplay.bIsDestroyed) {
                                    oExtension._oScheduleTimeDisplay = new Text({
                                        text: {
                                            parts: [{ path: 'AppointmentFrom', targetType: 'any' }, { path: 'AppointmentTo', targetType: 'any' }],
                                            formatter: function (aF, aT) {
                                                if (!aF || !aT || String(aF).indexOf("00:00:00") !== -1) return "";
                                                var fmt = function (t) { var p = String(t).split(":"); var h = parseInt(p[0], 10); var m = p[1] || "00"; var ampm = h >= 12 ? "PM" : "AM"; h = h % 12; h = h ? h : 12; return h + ":" + m + " " + ampm; };
                                                return fmt(aF) + " - " + fmt(aT);
                                            }
                                        }, width: "100%", textAlign: "Left"
                                    }).addStyleClass("jhahDisplayText jhahAppointmentDisplayValue");
                                    oExtension._oScheduleTimeDisplay.setBindingContext(oExtension._oScheduleActionContext);
                                }

                                if (!oExtension._oScheduleSlotInput || oExtension._oScheduleSlotInput.bIsDestroyed) {
                                    if (!oExtension._bSlotsLoaded) { oExtension._loadAllAppointmentSlots(); oExtension._bSlotsLoaded = true; }
                                    oExtension._oScheduleSlotInput = new Input({
                                        placeholder: "Choose a time slot", showValueHelp: true, valueHelpOnly: true, value: "{apptslots>/selectedLabel}",
                                        valueHelpRequest: function (oEvent) { oExtension._oScheduleActionContext = oView.getBindingContext(); oExtension._activeSlotInput = oExtension._oScheduleSlotInput; oExtension.onAppointmentSlotValueHelp(oEvent, true); }
                                    }).addStyleClass("jhahCustomTimeSlot");
                                    oExtension._oScheduleSlotInput.setBindingContext(oExtension._oScheduleActionContext);
                                }

                                var oExpectedTime = bIsEditMode ? oExtension._oScheduleSlotInput : oExtension._oScheduleTimeDisplay;
                                if (oExpectedTime) {
                                    var bTimeFound = false;
                                    oApptFromFE.getFields().forEach(function (oFld) {
                                        if (oFld === oExpectedTime) { bTimeFound = true; oFld.setVisible(true); } else oFld.setVisible(false);
                                    });
                                    if (!bTimeFound) oApptFromFE.addField(oExpectedTime);
                                }
                                oApptFromFE.setVisible(true);

                                if (oApptToFE) {
                                    oApptToFE.setVisible(false);
                                    oApptToFE.addStyleClass("jhahNukeField");
                                    oApptToFE.getFields().forEach(function (oFld) { oFld.setVisible(false); });
                                }
                            }
                        }

                    } catch (e) { oExtension._log("Error evaluating dynamic UI states:", e); }
                }, 150);
                $view.data("dynamicFeaturesAttached", true);
            }
        },
        override: {
            onInit: function () {
                var oExtension = this;
                var oView = oExtension.base.getView();

                this._log("Controller extension initialized.");

                var oFioriI18nModel = oView &&
                    oView.getModel("sap.fe.i18n");

                if (
                    oFioriI18nModel &&
                    !oFioriI18nModel.__jhahCustomTextsApplied
                ) {
                    oFioriI18nModel.enhance({
                        bundleName:
                            "com.jhah.zhrjhahsecid.i18n.i18n"
                    });

                    oFioriI18nModel.__jhahCustomTextsApplied = true;

                    this._log(
                        "Fiori Elements texts enhanced.",
                        {
                            bundleName:
                                "com.jhah.zhrjhahsecid.i18n.i18n"
                        }
                    );
                }

                oView.addStyleClass("zhrjhahsecid-app");
                document.body.classList.add(
                    "zhrjhahsecid-app"
                );

                var oAppComponent =
                    sap.ui.core.Component
                        .getOwnerComponentFor(oView);

                var oAppModel = oAppComponent
                    ? oAppComponent.getModel()
                    : oView.getModel();

                if (oAppModel) {
                    oExtension
                        ._checkAndApplyRoleAuth(oAppModel);
                }

                var oEmployeeModel =
                    new JSONModel({
                        isVisible: false
                    });

                oView.setModel(
                    oEmployeeModel,
                    "employeeInfo"
                );

                oView.addEventDelegate({
                    onAfterRendering: function () {
                        oExtension._updateRenewButtonState();
                        oExtension._hideEditingStatusFilter();
                        oExtension._applyUIEnhancements();
                    }
                }, oExtension);

                window._jhahDialogHookExtension = oExtension;

                if (!window._jhahDialogHookSetup) {
                    var fnOriginalOpen = sap.m.Dialog.prototype.open;
                    sap.m.Dialog.prototype.open = function () {
                        var oDialog = this;
                        var oExt = window._jhahDialogHookExtension;
                        if (!oExt) return fnOriginalOpen.apply(this, arguments);

                        setTimeout(function () {
                            try {
                                var sTitle = (typeof oDialog.getTitle === "function") ? String(oDialog.getTitle() || "") : "";
                                var sLowerTitle = sTitle.toLowerCase();
                                var bIsDeleteDialog = sLowerTitle.indexOf("delete") !== -1 || sLowerTitle.indexOf("cancel request") !== -1;

                                if (oExt._bAccessAreaDeletePending === true && bIsDeleteDialog) {
                                    oExt._bAccessAreaDeletePending = false;
                                    var aSavedContexts = oExt._aPendingAccessAreaDeleteContexts || [];
                                    oExt._aPendingAccessAreaDeleteContexts = null;
                                    oExt._configureAccessAreaDeleteDialog(oDialog, aSavedContexts);
                                    return;
                                }

                                if (oExt._bHeaderDeletePending === true && bIsDeleteDialog) {
                                    oExt._bHeaderDeletePending = false;
                                    var bIsMainDelete = false;
                                    var sNewTitle = "Delete";
                                    var oCtx = oExt.base.getView().getBindingContext();
                                    var bIsDraft = false;
                                    try { bIsDraft = (oCtx && oCtx.getObject() && oCtx.getObject().IsActiveEntity === false); } catch (e) { }

                                    var aTexts = oDialog.findAggregatedObjects(true, function (o) { return o.isA("sap.m.Text") || o.isA("sap.m.FormattedText"); });
                                    aTexts.forEach(function (oText) {
                                        var sText = typeof oText.getText === "function" ? oText.getText() : "";
                                        var sLower = sText.toLowerCase();
                                        if (sLower.indexOf("delete") !== -1 || sLower.indexOf("cancel") !== -1) {
                                            bIsMainDelete = true;
                                            if (bIsDraft) {
                                                sNewTitle = "Delete Draft";
                                                oText.setText("Do you want to delete this draft record?");
                                            } else {
                                                sNewTitle = "Cancel Request";
                                                oText.setText("Do you want to cancel this request?");
                                            }
                                        }
                                    });

                                    if (bIsMainDelete) {
                                        oDialog.setTitle(sNewTitle);
                                        oDialog.getButtons().forEach(function (oBtn) {
                                            if (oBtn.getText() === "Delete") oBtn.setText("Yes");
                                            else if (oBtn.getText() === "Cancel") oBtn.setText("No");
                                        });
                                    }
                                }

                                var aInputs = oDialog.findAggregatedObjects(true, function (o) { return o.isA("sap.m.InputBase") || o.isA("sap.ui.comp.smartfield.SmartField"); });
                                var bHasApptDate = false, bHasValidity = false;
                                aInputs.forEach(function (oFld) {
                                    var sPath = (typeof oFld.getBindingPath === "function") ? (oFld.getBindingPath("value") || oFld.getBindingPath("selectedKey") || "").toLowerCase() : "";
                                    if (sPath.indexOf("appointmentdate") !== -1 || sPath.indexOf("apptdate") !== -1) bHasApptDate = true;
                                    if (sPath.indexOf("validity") !== -1) bHasValidity = true;
                                });

                                if (bHasApptDate || sTitle.indexOf("chedule") !== -1) {
                                    oDialog.addStyleClass("jhahAppointmentDialog");
                                    var oSlotModel = oView.getModel("apptslots");
                                    if (oSlotModel) { oSlotModel.setProperty("/selectedLabel", ""); oSlotModel.setProperty("/selectedKey", ""); }
                                    oExt._loadAllAppointmentSlots();
                                    oDialog.setModel(oSlotModel, "apptslots");

                                    var aFormContainers = oDialog.findAggregatedObjects(true, function (o) { return o.isA("sap.ui.layout.form.FormContainer"); });
                                    if (aFormContainers.length > 0) {
                                        var oFormContainer = aFormContainers[0];
                                        var iDateIndex = -1;

                                        oFormContainer.getFormElements().forEach(function (oFE, index) {
                                            var aFields = oFE.getFields();
                                            if (aFields.length === 0) return;
                                            var oField = aFields[0];
                                            var sPath = (typeof oField.getBindingPath === "function") ? (oField.getBindingPath("value") || oField.getBindingPath("selectedKey") || "").toLowerCase() : "";

                                            if (sPath.indexOf("appointmentdate") !== -1 || sPath.indexOf("apptdate") !== -1) {
                                                iDateIndex = index;
                                                oExt._oScheduleParamDateField = oField;
                                                if (!oFE.data("isCustomized")) {
                                                    oFE.data("isCustomized", true);
                                                    oExt._oActionContext = oField.getBindingContext();
                                                    oField.setVisible(false);
                                                    oExt._oCustomDatePicker = new DatePicker({
                                                        value: { path: "AppointmentDate", type: 'sap.ui.model.odata.type.Date', formatOptions: { style: 'medium' } },
                                                        minDate: "{apptslots>/minDate}", maxDate: "{apptslots>/maxDate}", placeholder: "Choose a date",
                                                        change: function (oEvent) {
                                                            var oDate = oEvent.getSource().getDateValue();
                                                            if (oDate && oExt._oScheduleParamDateField) {
                                                                if (typeof oExt._oScheduleParamDateField.setDateValue === "function") {
                                                                    oExt._oScheduleParamDateField.setDateValue(oDate);
                                                                    oExt._oScheduleParamDateField.fireChange({ value: oDate });
                                                                } else if (typeof oExt._oScheduleParamDateField.setValue === "function") {
                                                                    var sDate = oDate.getFullYear() + "-" + String(oDate.getMonth() + 1).padStart(2, "0") + "-" + String(oDate.getDate()).padStart(2, "0");
                                                                    oExt._oScheduleParamDateField.setValue(sDate);
                                                                    oExt._oScheduleParamDateField.fireChange({ value: sDate });
                                                                }
                                                            }
                                                            oExt.onAppointmentDateChange(oEvent, false);
                                                        }
                                                    });
                                                    if (oExt._oActionContext) oExt._oCustomDatePicker.setBindingContext(oExt._oActionContext);
                                                    oFE.insertField(oExt._oCustomDatePicker, 1);
                                                }
                                            }
                                            if (sPath.indexOf("fromtime") !== -1 || sPath.indexOf("appointmentfrom") !== -1) { oExt._oScheduleParamFromField = oField; oFE.setVisible(false); }
                                            if (sPath.indexOf("totime") !== -1 || sPath.indexOf("appointmentto") !== -1) { oExt._oScheduleParamToField = oField; oFE.setVisible(false); }
                                            if (sPath.indexOf("slotid") !== -1) { oExt._oScheduleParamSlotIdField = oField; oFE.setVisible(false); }
                                            if (sPath.indexOf("appointmentlocation") !== -1 || sPath.indexOf("apptlocation") !== -1) { oExt._oScheduleParamLocationField = oField; }
                                        });

                                        if (iDateIndex !== -1 && !oDialog.data("timeInputInjected")) {
                                            oDialog.data("timeInputInjected", true);
                                            oExt._oCustomSlotInput = new Input({
                                                placeholder: "Choose a time slot", showValueHelp: true, valueHelpOnly: true, value: "{apptslots>/selectedLabel}",
                                                valueHelpRequest: function (oEvent) { oExt._activeSlotInput = oExt._oCustomSlotInput; oExt.onAppointmentSlotValueHelp(oEvent, false); }
                                            });
                                            if (oExt._oActionContext) oExt._oCustomSlotInput.setBindingContext(oExt._oActionContext);
                                            var oTimeFormElement = new FormElement({ label: new Label({ text: "Appointment Time" }), fields: [oExt._oCustomSlotInput] });
                                            oFormContainer.insertFormElement(oTimeFormElement, iDateIndex + 1);

                                            var oSubmitBtn = oDialog.getBeginButton();
                                            if (oSubmitBtn && !oSubmitBtn.data("isGuarded")) {
                                                oSubmitBtn.data("isGuarded", true);
                                                var aHandlers = (oSubmitBtn.mEventRegistry && oSubmitBtn.mEventRegistry.press) ? oSubmitBtn.mEventRegistry.press.slice() : [];
                                                aHandlers.forEach(function (h) { oSubmitBtn.detachPress(h.fFunction, h.oListener); });
                                                oSubmitBtn.attachPress(function (oEvent) {
                                                    var sTimeVal = oExt._oCustomSlotInput ? oExt._oCustomSlotInput.getValue() : "";
                                                    if (!sTimeVal || sTimeVal.trim() === "") { MessageToast.show("Please select an Appointment Time."); return; }
                                                    aHandlers.forEach(function (h) { h.fFunction.call(h.oListener || oSubmitBtn, oEvent); });
                                                });
                                            }
                                        }
                                    }
                                }

                                if (bHasValidity || sTitle.indexOf("Issue") !== -1) {
                                    var aFormContainers = oDialog.findAggregatedObjects(true, function (o) { return o.isA("sap.ui.layout.form.FormContainer"); });
                                    if (aFormContainers.length > 0) {
                                        var oFormContainer = aFormContainers[0];
                                        if (!oDialog.data("contractExpiryInjected")) {
                                            oDialog.data("contractExpiryInjected", true);
                                            var oHeaderContext = oExt.base.getView().getBindingContext();
                                            var oContractInput = new Input({ value: "Loading...", editable: false });
                                            var oContractExpiryElement = new FormElement({ label: new Label({ text: "Contract Expiry Date" }), fields: [oContractInput] });
                                            oFormContainer.insertFormElement(oContractExpiryElement, 0);

                                            var fnFormatDate = function (rDate) {
                                                if (!rDate || String(rDate).indexOf("0000") !== -1) return "N/A";
                                                var sRawStr = String(rDate).trim();
                                                if (sRawStr.length === 8 && !sRawStr.includes("-")) sRawStr = sRawStr.substring(0, 4) + "-" + sRawStr.substring(4, 6) + "-" + sRawStr.substring(6, 8);
                                                var dDate = new Date(sRawStr);
                                                if (!isNaN(dDate.getTime())) {
                                                    var aMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                                                    return aMonths[dDate.getMonth()] + " " + String(dDate.getDate()).padStart(2, '0') + ", " + dDate.getFullYear();
                                                }
                                                return sRawStr;
                                            };

                                            var oEmpModel = oExt.base.getView().getModel("employeeInfo");
                                            var rawDate = oEmpModel ? oEmpModel.getProperty("/ContractEnddate") : null;
                                            if (rawDate) { oContractInput.setValue(fnFormatDate(rawDate)); }
                                            else if (oHeaderContext) {
                                                oHeaderContext.requestProperty("ContractEnddate").then(function (val) { oContractInput.setValue(fnFormatDate(val)); }).catch(function () { oContractInput.setValue("N/A"); });
                                            } else { oContractInput.setValue("N/A"); }
                                        }

                                        var oValidityField = null, oActionContext = null, oExpiryFE = null;
                                        oFormContainer.getFormElements().forEach(function (oFE) {
                                            var aFields = oFE.getFields();
                                            if (aFields.length === 0) return;
                                            var sPath = (typeof aFields[0].getBindingPath === "function") ? (aFields[0].getBindingPath("value") || aFields[0].getBindingPath("selectedKey") || "").toLowerCase() : "";
                                            if (sPath.indexOf("validity") !== -1) { oValidityField = aFields[0]; oActionContext = oValidityField.getBindingContext(); }
                                            if (sPath.indexOf("expirydate") !== -1) oExpiryFE = oFE;
                                            if (sPath.indexOf("hideexpiry") !== -1) oFE.setVisible(false);
                                        });

                                        if (oValidityField && oExpiryFE && !oDialog.data("issueIdBound")) {
                                            oDialog.data("issueIdBound", true);
                                            var fnEvaluateVisibility = function () {
                                                try {
                                                    var sVal = (typeof oValidityField.getSelectedKey === "function") ? oValidityField.getSelectedKey() : oValidityField.getValue();
                                                    var bShowExpiry = (String(sVal || "").trim().toUpperCase() === "OT");
                                                    oExpiryFE.getFields()[0].setVisible(bShowExpiry);
                                                    if (oExpiryFE.getLabelControl) oExpiryFE.getLabelControl().setVisible(bShowExpiry);
                                                    var sHidePayload = bShowExpiry ? "" : "X";
                                                    oExt._setSafeProperty(oActionContext, "HideExpiry", sHidePayload);
                                                } catch (e) { }
                                            };
                                            fnEvaluateVisibility();
                                            if (typeof oValidityField.attachChange === "function") oValidityField.attachChange(function () { setTimeout(fnEvaluateVisibility, 150); });
                                        }
                                    }
                                }

                            } catch (e) { oExt._log("Error evaluating dialog layout", e); }
                        }, 50);

                        return fnOriginalOpen.apply(this, arguments);
                    };
                    window._jhahDialogHookSetup = true;
                }
            },

            // ============================================================
            // 9. ROUTING LIFECYCLE
            // ============================================================
            routing: {
                onAfterBinding: function (oBindingContext) {
                    var oView = this.base.getView();
                    var oAppModel = oView.getModel();
                    if (!oAppModel) return;

                    this._checkAndApplyRoleAuth(oAppModel);

                    if (oBindingContext && oBindingContext.getPath().indexOf("/Header") !== -1) {
                        this._log("Route parameters established. Fetching record data.");
                        var sPropName = "PayrollNum";
                        oBindingContext.requestProperty(sPropName).then(function (sPayrollNum) {
                            if (!sPayrollNum) { return oBindingContext.requestProperty("Pernr"); }
                            return sPayrollNum;
                        }).then(function (sDataId) {
                            this._fetchEmployeeDetails(sDataId);
                            this._loadActiveIDAndFragment(sDataId);
                        }.bind(this)).catch(function () { });

                        if (this._oPayrollBinding) {
                            this._oPayrollBinding.detachChange(this._onPayrollModelChanged, this);
                            this._oPayrollBinding.destroy();
                        }
                        this._oPayrollBinding = oAppModel.bindProperty(sPropName, oBindingContext);
                        this._oPayrollBinding.attachChange(this._onPayrollModelChanged, this);
                    }
                }
            }
        }
    });
});
