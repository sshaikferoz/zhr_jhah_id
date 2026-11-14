sap.ui.define([
    "sap/m/MessageToast"
], function (MessageToast) {
    "use strict";

    function navigate(sSemanticObject) {
        var oContainer = sap.ushell && sap.ushell.Container;
        if (!oContainer) {
            MessageToast.show("Cross-App Navigation is not supported in this environment."); //for BAS preview
            return;
        }
        oContainer.getServiceAsync("Navigation").then(function (oNavigation) {
            oNavigation.navigate({
                target: {
                    semanticObject: sSemanticObject,
                    action: "manage"
                }
            });
        }).catch(function () {
            MessageToast.show("Navigation to " + sSemanticObject + " failed.");
        });
    }

    return {
        navigateToMaintainBlockedID: function () { navigate("maintblkid"); },
        navigateToMaintainIDLocation: function () { navigate("maintidloc"); },
        navigateToMaintainAccessArea: function () { navigate("maintidaccessarea"); }
    };
});