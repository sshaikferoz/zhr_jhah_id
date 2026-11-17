sap.ui.define(["com/jhah/zhrjhahsecid1/ext/util/Constants"], function (Constants) {
  "use strict";

  /**
   * Reads numeric parameters (e.g. Constants.CONFIG.RENEW_DAYS) for the ID app from the shared
   * configuration service (manifest data source "idConfigService", model Constants.MODEL.ID_CONFIG).
   */
  const APP_ID = Constants.CONFIG.APP_ID;

  /** One /config request per model */
  const _mCache = new WeakMap();

  function loadRows(oConfigModel) {
    if (!_mCache.has(oConfigModel)) {
      const pRows = oConfigModel
        .bindList("/config", null, null, null, { $$groupId: "$direct" })
        .requestContexts(0, Infinity)
        .then(function (aContexts) {
          return aContexts
            .map(function (oContext) {
              return oContext.getObject();
            })
            .filter(function (oRow) {
              return oRow.AppId === APP_ID;
            });
        })
        .catch(function (oError) {
          _mCache.delete(oConfigModel); // allow a retry on the next call
          throw oError;
        });
      _mCache.set(oConfigModel, pRows);
    }
    return _mCache.get(oConfigModel);
  }

  return {
    /**
     * @param {sap.ui.model.odata.v4.ODataModel} oConfigModel The Constants.MODEL.ID_CONFIG model
     * @param {string} sParamKey Parameter key, one of Constants.CONFIG
     * @returns {Promise<number>} Rejects if the parameter is missing or not numeric
     */
    getNumber: function (oConfigModel, sParamKey) {
      if (!oConfigModel) {
        return Promise.reject(new Error("Model '" + Constants.MODEL.ID_CONFIG + "' is not available."));
      }
      return loadRows(oConfigModel).then(function (aRows) {
        const oRow = aRows.find(function (oItem) {
          return oItem.ParamKey === sParamKey;
        });
        const iValue = oRow ? parseInt(oRow.ParamVal, 10) : NaN;
        if (isNaN(iValue)) {
          throw new Error(APP_ID + " " + sParamKey + " is missing or not numeric.");
        }
        return iValue;
      });
    }
  };
});
