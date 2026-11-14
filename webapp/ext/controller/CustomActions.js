sap.ui.define(
  ["sap/m/MessageToast", "sap/base/Log", "com/jhah/zhrjhahsecid/ext/util/Constants"],
  function (MessageToast, Log, Constants) {
    "use strict";

    /**
     * Handlers for the "Maintain Master Data" menu (manifest.json, AdminList table actions).
     * SAP Fiori elements calls manifest action handlers with "this" = the page's ExtensionAPI.
     */
    function navigate(oExtensionAPI, sSemanticObject) {
      const oBundle = oExtensionAPI.getModel(Constants.MODEL.I18N).getResourceBundle();
      return Promise.resolve()
        .then(function () {
          return oExtensionAPI.getIntentBasedNavigation().navigate(sSemanticObject, "manage");
        })
        .catch(function (oError) {
          Log.warning("Navigation to " + sSemanticObject + " failed", oError);
          MessageToast.show(oBundle.getText("navigationFailed", [sSemanticObject]));
        });
    }

    return {
      navigateToMaintainBlockedID: function () {
        return navigate(this, "maintblkid");
      },
      navigateToMaintainIDLocation: function () {
        return navigate(this, "maintidloc");
      },
      navigateToMaintainAccessArea: function () {
        return navigate(this, "maintidaccessarea");
      }
    };
  }
);
