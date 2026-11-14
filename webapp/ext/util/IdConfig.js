sap.ui.define([], function () {
  "use strict";

  /**
   * Reads numeric parameters (e.g. RENEW_DAYS) for the ID app from the shared configuration
   * service, declared in manifest.json as data source "idConfigService" / model "idConfig".
   */
  var ID_APP_ID = "ID_APP";
  var _mCache = new WeakMap();

  function loadRows(oConfigModel) {
    if (!_mCache.has(oConfigModel)) {
      var oBinding = oConfigModel.bindList(
        "/config",
        null,
        null,
        null,
        { $$groupId: "$direct" }
      );
      var pRows = oBinding
        .requestContexts(0, Infinity)
        .then(function (aContexts) {
          return aContexts
            .map(function (oContext) {
              return oContext.getObject();
            })
            .filter(function (oRow) {
              return oRow.AppId === ID_APP_ID;
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
     * @param {sap.ui.model.odata.v4.ODataModel} oConfigModel The "idConfig" model
     * @param {string} sParamKey Parameter key, e.g. "RENEW_DAYS"
     * @returns {Promise<number>} Rejects if the parameter is missing or not numeric
     */
    getNumber: function (oConfigModel, sParamKey) {
      if (!oConfigModel) {
        return Promise.reject(new Error("Model 'idConfig' is not available."));
      }
      return loadRows(oConfigModel).then(function (aRows) {
        var oRow = aRows.find(function (oItem) {
          return oItem.ParamKey === sParamKey;
        });
        var iValue = oRow ? parseInt(oRow.ParamVal, 10) : NaN;
        if (isNaN(iValue)) {
          throw new Error(ID_APP_ID + " " + sParamKey + " is missing or not numeric.");
        }
        return iValue;
      });
    }
  };
});
