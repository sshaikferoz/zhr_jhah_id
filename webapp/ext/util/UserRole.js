sap.ui.define(["com/jhah/zhrjhahsecid1/ext/util/Constants"], function (Constants) {
  "use strict";

  /**
   * Resolves the current user's role once per OData model (from the /authInfo entity set)
   * and maps it to the UI mode used by the List Report tabs and the transitional CSS action gate.
   *
   * Authorization itself must be enforced by the backend (RAP authorization / feature control).
   * The mode returned here only decides what the UI offers.
   */
  const MODE = Constants.MODE;
  const TAB_KEY = Constants.TAB_KEY;
  const CSS_CLASS = Constants.CSS_CLASS;
  const BACKEND_ROLE = Constants.BACKEND_ROLE;

  /** Tabs each mode must not see */
  const HIDDEN_TABS = Object.freeze({
    [MODE.EMPLOYEE]: [TAB_KEY.HR, TAB_KEY.ADMIN],
    [MODE.HR]: [TAB_KEY.ADMIN],
    [MODE.SECURITY]: [TAB_KEY.HR]
  });

  const ALL_MODES = Object.values(MODE);

  /** One role request per model */
  const _mCache = new WeakMap();

  function toMode(sRole) {
    const sNormalized = String(sRole || "").trim().toUpperCase();
    if (sNormalized === BACKEND_ROLE.ADMIN || sNormalized === BACKEND_ROLE.SECURITY) {
      return MODE.SECURITY;
    }
    if (sNormalized === BACKEND_ROLE.HR || sNormalized === BACKEND_ROLE.HR_ADMIN) {
      return MODE.HR;
    }
    return MODE.EMPLOYEE;
  }

  return {
    /** Tab keys in display order */
    TAB_KEYS: Object.values(TAB_KEY),

    /**
     * @param {sap.ui.model.odata.v4.ODataModel} oModel The main service model
     * @returns {Promise<string>} Resolves with one of Constants.MODE; falls back to employee mode on any error
     */
    getMode: function (oModel) {
      if (!_mCache.has(oModel)) {
        const pMode = oModel
          .bindList("/authInfo", null, null, null, { $$groupId: "$direct" })
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
     * While the role is unknown the view carries CSS_CLASS.ROLE_LOADING so role-gated buttons do not flash.
     */
    applyModeClass: function (oView, oModel) {
      oView.addStyleClass(CSS_CLASS.APP);
      oView.addStyleClass(CSS_CLASS.ROLE_LOADING);
      return this.getMode(oModel).then(function (sMode) {
        ALL_MODES.forEach(function (sClass) {
          oView.toggleStyleClass(sClass, sClass === sMode);
        });
        oView.removeStyleClass(CSS_CLASS.ROLE_LOADING);
        return sMode;
      });
    }
  };
});
