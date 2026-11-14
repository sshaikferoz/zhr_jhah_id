sap.ui.define(
  [
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/base/Log",
    "com/jhah/zhrjhahsecid/ext/util/Constants"
  ],
  function (Fragment, JSONModel, Filter, FilterOperator, MessageToast, Log, Constants) {
    "use strict";

    const LOG_COMPONENT = Constants.LOG_COMPONENT.ISSUE_ID_DIALOG;

    function todayEdm() {
      const o = new Date();
      return new Date(o.getFullYear(), o.getMonth(), o.getDate());
    }

    /**
     * "Issue ID Card" for one request, used from the Object Page header and the Security
     * Admin table. Collects the IssueID parameters in its own dialog and calls the action
     * through the SAP Fiori elements edit flow (messages, side effects, busy handling).
     *
     * @param {sap.fe.core.ExtensionAPI} oExtensionAPI Page extension API (owner of the dialog)
     */
    function IssueIdDialog(oExtensionAPI) {
      this._oExtensionAPI = oExtensionAPI;
      this._oModel = new JSONModel();
    }

    IssueIdDialog.prototype._getBundle = function () {
      return this._oExtensionAPI.getModel(Constants.MODEL.I18N).getResourceBundle();
    };

    IssueIdDialog.prototype._getDialog = function () {
      if (!this._pDialog) {
        this._pDialog = Fragment.load({
          name: "com.jhah.zhrjhahsecid.ext.fragment.IssueIdDialog",
          controller: this
        }).then(
          function (oDialog) {
            oDialog.setModel(this._oModel, Constants.MODEL.ISSUE_ID);
            this._oExtensionAPI.addDependent(oDialog);
            return oDialog;
          }.bind(this)
        );
      }
      return this._pDialog;
    };

    /** Contract end date (YYYYMMDD string) of the request's employee; "" if unknown. */
    IssueIdDialog.prototype._loadContractEnd = function (oContext) {
      return oContext
        .requestProperty("PayrollNum")
        .then(function (sPayrollNum) {
          if (!sPayrollNum) {
            return "";
          }
          return oContext
            .getModel()
            .bindList(
              "/EmployeeDetails",
              null,
              null,
              [new Filter("Pernr", FilterOperator.EQ, sPayrollNum)],
              { $$groupId: "$direct", $select: "Pernr,ContractEnddate" }
            )
            .requestContexts(0, 1)
            .then(function (aContexts) {
              var s = aContexts[0] && aContexts[0].getProperty("ContractEnddate");
              return s && !/^0+$/.test(s) ? s : "";
            });
        })
        .catch(function (oError) {
          Log.warning("Contract end date not available", oError, LOG_COMPONENT);
          return "";
        });
    };

    /** @param {sap.ui.model.odata.v4.Context} oContext the request (Header) to issue the ID for */
    IssueIdDialog.prototype.open = function (oContext) {
      this._oContext = oContext;
      this._oModel.setData({
        contractEnd: "",
        validity: "",
        validityState: "None",
        showExpiry: false,
        expiryDate: "",
        expiryState: "None",
        minExpiry: todayEdm(),
        remarks: ""
      });
      return Promise.all([this._getDialog(), this._loadContractEnd(oContext)]).then(
        function (aResults) {
          this._oModel.setProperty("/contractEnd", aResults[1] || this._getBundle().getText("notAvailable"));
          aResults[0].open();
        }.bind(this)
      );
    };

    IssueIdDialog.prototype.onValidityChange = function () {
      var bOther = this._oModel.getProperty("/validity") === Constants.VALIDITY_OTHER;
      this._oModel.setProperty("/showExpiry", bOther);
      this._oModel.setProperty("/validityState", "None");
      if (!bOther) {
        this._oModel.setProperty("/expiryDate", "");
        this._oModel.setProperty("/expiryState", "None");
      }
    };

    IssueIdDialog.prototype.onCancel = function () {
      this._getDialog().then(function (oDialog) {
        oDialog.close();
      });
    };

    IssueIdDialog.prototype._validate = function () {
      var oData = this._oModel.getData();
      var bValid = true;
      if (!oData.validity) {
        this._oModel.setProperty("/validityState", "Error");
        bValid = false;
      }
      if (oData.showExpiry && !oData.expiryDate) {
        this._oModel.setProperty("/expiryState", "Error");
        bValid = false;
      }
      return bValid;
    };

    IssueIdDialog.prototype.onSubmit = function () {
      if (!this._validate()) {
        MessageToast.show(this._getBundle().getText("fillRequiredFields"));
        return;
      }
      var oData = this._oModel.getData();
      var oBundle = this._getBundle();

      this._getDialog().then(
        function (oDialog) {
          oDialog.setBusy(true);
          this._oExtensionAPI
            .getEditFlow()
            .invokeAction(Constants.ACTION.ISSUE_ID, {
              contexts: this._oContext,
              parameterValues: [
                { name: "Validity", value: oData.validity },
                { name: "ExpiryDate", value: oData.showExpiry ? oData.expiryDate : null },
                { name: "Remarks", value: oData.remarks || "" }
              ],
              skipParameterDialog: true,
              invocationGrouping: "Isolated",
              label: oBundle.getText("issueIdTitle")
            })
            .then(function () {
              oDialog.close();
            })
            .catch(function (oError) {
              // SAP Fiori elements already shows the backend messages
              Log.error("IssueID failed", oError, LOG_COMPONENT);
            })
            .finally(function () {
              oDialog.setBusy(false);
            });
        }.bind(this)
      );
    };

    return IssueIdDialog;
  }
);
