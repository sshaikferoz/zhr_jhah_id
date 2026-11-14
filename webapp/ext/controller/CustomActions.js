sap.ui.define(["sap/m/MessageToast", "sap/base/Log"], function (MessageToast, Log) {
  "use strict";

  /**
   * Handlers for the "Maintain Master Data" menu (manifest.json, AdminList table actions).
   * SAP Fiori elements calls manifest action handlers with "this" = the page's ExtensionAPI.
   */
  function navigate(oExtensionAPI, sSemanticObject) {
    var oBundle = oExtensionAPI.getModel("i18n").getResourceBundle();
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
});
