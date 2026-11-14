sap.ui.define([], function () {
  "use strict";

  /**
   * Resolves the current user's role once per OData model (from the /authInfo entity set)
   * and maps it to the UI mode used by the List Report tabs and the transitional CSS action gate.
   *
   * Authorization itself must be enforced by the backend (RAP authorization / feature control).
   * The mode returned here only decides what the UI offers.
   */
  var MODE = {
    EMPLOYEE: "employeeMode",
    HR: "hrMode",
    SECURITY: "securityMode"
  };

  /** Tab keys (manifest views.paths[].key) that each mode must not see. */
  var HIDDEN_TABS = {
    employeeMode: ["HRTabKey", "AdminTabKey"],
    hrMode: ["AdminTabKey"],
    securityMode: ["HRTabKey"]
  };

  var ALL_MODES = [MODE.EMPLOYEE, MODE.HR, MODE.SECURITY];
  var LOADING_CLASS = "jhahRoleLoading";
  /** Scopes generic selectors in css/custom.css to this app's views (CSS stays loaded in the FLP). */
  var APP_CLASS = "zhrjhahsecid-app";

  var _mCache = new WeakMap();

  function toMode(sRole) {
    var sNormalized = String(sRole || "").trim().toUpperCase();
    if (sNormalized === "ADMIN" || sNormalized === "SECURITY") {
      return MODE.SECURITY;
    }
    if (sNormalized === "HR" || sNormalized === "HRADMIN") {
      return MODE.HR;
    }
    return MODE.EMPLOYEE;
  }

  return {
    MODE: MODE,

    /** manifest views.paths[].key, in display order */
    TAB_KEYS: ["HRTabKey", "AdminTabKey", "EmpTabKey"],

    /**
     * @param {sap.ui.model.odata.v4.ODataModel} oModel The main service model
     * @returns {Promise<string>} Resolves with one of MODE.*; falls back to employee mode on any error
     */
    getMode: function (oModel) {
      if (!_mCache.has(oModel)) {
        var oBinding = oModel.bindList("/authInfo", null, null, null, {
          $$groupId: "$direct"
        });
        var pMode = oBinding
          .requestContexts(0, 1)
          .then(function (aContexts) {
            return toMode(aContexts[0] && aContexts[0].getProperty("ROLE"));
          })
          .catch(function () {
            return MODE.EMPLOYEE;
          });
        _mCache.set(oModel, pMode);
      }
      return _mCache.get(oModel);
    },

    getHiddenTabKeys: function (sMode) {
      return HIDDEN_TABS[sMode] || [];
    },

    /**
     * Puts the mode class on the view (used by css/custom.css section "Transitional action gate").
     * While the role is unknown the view carries LOADING_CLASS so role-gated buttons do not flash.
     */
    applyModeClass: function (oView, oModel) {
      oView.addStyleClass(APP_CLASS);
      oView.addStyleClass(LOADING_CLASS);
      return this.getMode(oModel).then(function (sMode) {
        ALL_MODES.forEach(function (sClass) {
          oView.toggleStyleClass(sClass, sClass === sMode);
        });
        oView.removeStyleClass(LOADING_CLASS);
        return sMode;
      });
    }
  };
});
