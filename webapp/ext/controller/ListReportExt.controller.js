sap.ui.define(
  [
    "sap/ui/core/mvc/ControllerExtension",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/base/Log",
    "com/jhah/zhrjhahsecid/ext/util/UserRole",
    "com/jhah/zhrjhahsecid/ext/util/IdConfig"
  ],
  function (ControllerExtension, Fragment, JSONModel, Log, UserRole, IdConfig) {
    "use strict";

    var LOG_COMPONENT = "com.jhah.zhrjhahsecid.ListReportExt";
    var MS_PER_DAY = 24 * 60 * 60 * 1000;

    /**
     * List Report extension.
     *
     * - Role: puts the role class on the view and hides the tabs the role must not see.
     * - "My Active ID" card above the table.
     *
     * Everything else (texts, filters per tab, table settings, row actions) is configured in
     * manifest.json, i18n/fe.properties and annotations/annotation.xml.
     */
    return ControllerExtension.extend(
      "com.jhah.zhrjhahsecid.ext.controller.ListReportExt",
      {
        override: {
          onInit: function () {
            var oView = this.base.getView();
            var oModel = this.base.getAppComponent().getModel();

            oView.setModel(new JSONModel({ visible: false }), "activeIDModel");

            this._pRendered = new Promise(
              function (resolve) {
                this._fnResolveRendered = resolve;
              }.bind(this)
            );

            var pMode = UserRole.applyModeClass(oView, oModel);

            Promise.all([pMode, this._pRendered]).then(
              this._applyTabVisibility.bind(this)
            );
            Promise.all([this._loadActiveId(), this._pRendered]).then(
              this._showActiveIdCard.bind(this)
            );
          },

          onAfterRendering: function () {
            if (this._fnResolveRendered) {
              this._fnResolveRendered();
              this._fnResolveRendered = null;
            }
          }
        },

        // ------------------------------------------------------------------
        // Role-based tabs
        // ------------------------------------------------------------------

        /**
         * SAP Fiori elements offers no manifest switch to hide a view (tab) per user, so the
         * tab filters are hidden once through the public IconTabFilter API. Nothing is polled
         * and the DOM is not touched. Replace this with role-specific launchpad targets (or
         * backend-driven variants) when available - see docs/backend-requirements.md.
         */
        _applyTabVisibility: function (aResults) {
          var sMode = aResults[0];
          var aHiddenKeys = UserRole.getHiddenTabKeys(sMode);
          var oView = this.base.getView();

          // FE names the tab filter "fe::table::<manifest key>::LineItem"
          var fnTabKey = function (sManifestKey) {
            return "fe::table::" + sManifestKey + "::LineItem";
          };

          var aTabs = oView.findAggregatedObjects(true, function (oControl) {
            return oControl.isA("sap.m.IconTabFilter");
          });
          var oTabBar = aTabs.length ? aTabs[0].getParent() : null;
          var sSelectedKey =
            oTabBar && oTabBar.getSelectedKey ? oTabBar.getSelectedKey() : "";

          aTabs.forEach(function (oTab) {
            var bHidden = aHiddenKeys.some(function (sHiddenKey) {
              return oTab.getKey() === fnTabKey(sHiddenKey);
            });
            oTab.setVisible(!bHidden);
          });

          var bSelectedHidden = aHiddenKeys.some(function (sHiddenKey) {
            return sSelectedKey === fnTabKey(sHiddenKey);
          });
          var sFirstAllowed = UserRole.TAB_KEYS.find(function (sKey) {
            return aHiddenKeys.indexOf(sKey) === -1;
          });
          if (bSelectedHidden && sFirstAllowed) {
            var oExtensionAPI = this.base.getExtensionAPI();
            // ExtensionAPI expects the manifest key (views.paths[].key)
            oExtensionAPI.setSelectedTab(sFirstAllowed);
            // Switching tabs this way does not load the newly shown table; trigger "Go"
            oExtensionAPI.refresh();
          }
        },

        // ------------------------------------------------------------------
        // "My Active ID" card
        // ------------------------------------------------------------------

        /**
         * @returns {Promise<object|null>} card data, or null when the user has no active ID
         *   or the renewal window cannot be read (the card is then not shown at all, so a status
         *   computed with a wrong window is never displayed).
         */
        _loadActiveId: function () {
          var oComponent = this.base.getAppComponent();
          var oModel = oComponent.getModel();
          var oBinding = oModel.bindList("/activeID", null, null, null, {
            $$groupId: "$direct"
          });

          return Promise.all([
            oBinding.requestContexts(0, 1),
            IdConfig.getNumber(oComponent.getModel("idConfig"), "RENEW_DAYS")
          ])
            .then(function (aResults) {
              var oContext = aResults[0][0];
              var oData = oContext && oContext.getObject();
              if (!oData || !String(oData.IdNumber || "").trim()) {
                return null;
              }
              return this._buildCardData(oData, aResults[1]);
            }.bind(this))
            .catch(function (oError) {
              Log.warning("Active ID card not shown", oError, LOG_COMPONENT);
              return null;
            });
        },

        _buildCardData: function (oData, iRenewDays) {
          var oBundle = this.base
            .getAppComponent()
            .getModel("i18n")
            .getResourceBundle();
          var oCard = Object.assign({}, oData, {
            visible: true,
            renewDays: iRenewDays,
            renewInfo: oBundle.getText("activeIdRenewInfo", [iRenewDays])
          });

          if (!oData.ExpiryDate) {
            return oCard;
          }

          var oExpiry = new Date(oData.ExpiryDate);
          var oToday = new Date();
          oExpiry.setHours(0, 0, 0, 0);
          oToday.setHours(0, 0, 0, 0);
          var iDays = Math.round((oExpiry - oToday) / MS_PER_DAY);

          oCard.DaystoExpire = iDays;
          oCard.IsExpiringSoon = iDays <= iRenewDays;
          oCard.daysCritical = iDays <= 0;
          oCard.DaystoExpireText =
            iDays < 0
              ? oBundle.getText("activeIdDaysAgo", [Math.abs(iDays)])
              : oBundle.getText("activeIdDays", [iDays]);

          if (iDays < 0) {
            oCard.StatusText = oBundle.getText("activeIdStatusExpired");
            oCard.StatusState = "Error";
          } else if (iDays === 0) {
            oCard.StatusText = oBundle.getText("activeIdStatusExpiringToday");
            oCard.StatusState = "Error";
          } else if (iDays <= iRenewDays) {
            oCard.StatusText = oBundle.getText("activeIdStatusRenewal");
            oCard.StatusState = "Warning";
          } else {
            oCard.StatusText = oBundle.getText("activeIdStatusActive");
            oCard.StatusState = "Success";
          }
          return oCard;
        },

        /**
         * The List Report has no extension point in its page header, so the card is added
         * to the DynamicPage header once, after the first rendering.
         */
        _showActiveIdCard: function (aResults) {
          var oCardData = aResults[0];
          var oView = this.base.getView();
          if (!oCardData || oView.isDestroyed()) {
            return;
          }
          oView.getModel("activeIDModel").setData(oCardData);

          var oPage = oView.findAggregatedObjects(true, function (oControl) {
            return oControl.isA("sap.f.DynamicPage");
          })[0];
          var oHeader = oPage && oPage.getHeader();
          if (!oHeader || this._oActiveIdCard) {
            return;
          }

          Fragment.load({
            id: oView.getId(),
            name: "com.jhah.zhrjhahsecid.ext.fragment.ActiveIdCard",
            controller: this
          }).then(
            function (oCard) {
              this._oActiveIdCard = oCard;
              oHeader.insertContent(oCard, 0);
            }.bind(this)
          );
        }
      }
    );
  }
);
