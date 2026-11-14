sap.ui.define(
  [
    "sap/m/MessageToast",
    "com/jhah/zhrjhahsecid/ext/util/IssueIdDialog",
    "com/jhah/zhrjhahsecid/ext/util/Constants"
  ],
  function (MessageToast, IssueIdDialog, Constants) {
    "use strict";

    /**
     * Manifest handlers for the "Issue ID Card" custom action.
     * SAP Fiori elements calls them with "this" = the page's ExtensionAPI and
     * (pageContext, selectedContexts) as arguments.
     */
    const _mDialogs = new WeakMap(); // one dialog per page (ExtensionAPI)

    function getDialog(oExtensionAPI) {
      if (!_mDialogs.has(oExtensionAPI)) {
        _mDialogs.set(oExtensionAPI, new IssueIdDialog(oExtensionAPI));
      }
      return _mDialogs.get(oExtensionAPI);
    }

    return {
      /** Object Page header: the request shown on the page (button visibility: manifest) */
      onIssueIdFromObjectPage: function (oPageContext) {
        return getDialog(this).open(oPageContext);
      },

      /** Security Admin table: the selected request; availability comes from the backend */
      onIssueIdFromList: function (oPageContext, aSelectedContexts) {
        var oContext = aSelectedContexts[0];
        return oContext.requestProperty("__OperationControl/IssueID").then(
          function (bAllowed) {
            if (bAllowed !== true) {
              MessageToast.show(this.getModel(Constants.MODEL.I18N).getResourceBundle().getText("issueIdNotAllowed"));
              return undefined;
            }
            return getDialog(this).open(oContext);
          }.bind(this)
        );
      },

      /** "enabled" for the table action: exactly one request selected */
      isSingleSelection: function (oBindingContext, aSelectedContexts) {
        return Array.isArray(aSelectedContexts) && aSelectedContexts.length === 1;
      }
    };
  }
);
