sap.ui.define([
    "sap/ui/core/mvc/ControllerExtension",
    "sap/ui/core/Element",
    "sap/ui/model/json/JSONModel"
], function (ControllerExtension, Element, JSONModel) {
    "use strict";

    return ControllerExtension.extend("com.jhah.zhrjhahsecid.ext.controller.ObjectPageExt", {
        
        _sLatestRequestedId: null, 
        _oPayrollBinding: null,     

        _fetchEmployeeDetails: function (sPayrollNum) {
            var oView = this.base.getView();
            var oAppModel = oView.getModel();
            var oEmployeeModel = oView.getModel("employeeInfo");
            
            if (!oAppModel || !oEmployeeModel) return;

            var sCleanId = (sPayrollNum || "").trim();
            if (this._sLatestRequestedId === sCleanId) return; 
            
            this._sLatestRequestedId = sCleanId; 

            if (sCleanId !== "") {
                var sPath = "/EmployeeDetails('" + sCleanId + "')"; 
                var oContext = oAppModel.bindContext(sPath, null, { "$$groupId": "$direct" });
                
                oContext.requestObject().then(function(oData) {
                    if (this._sLatestRequestedId !== sCleanId) return;
                    if (oData) {
                        oEmployeeModel.setData(Object.assign({}, oData, { isVisible: true }));
                    } else {
                        oEmployeeModel.setData({ isVisible: false });
                    }
                    oEmployeeModel.refresh(true); 
                }.bind(this)).catch(function(err) {
                    if (this._sLatestRequestedId !== sCleanId) return; 
                    oEmployeeModel.setData({ isVisible: false });
                    oEmployeeModel.refresh(true); 
                }.bind(this));
            } else {
                oEmployeeModel.setData({ isVisible: false });
                oEmployeeModel.refresh(true); 
            }
        },

        _onPayrollModelChanged: function (oEvent) {
            var sNewVal = oEvent.getSource().getValue();
            this._fetchEmployeeDetails(sNewVal);
        },
        
        override: {
            onInit: function () {
                var oExtension = this;
                var oView = oExtension.base.getView();

                try {
                    var oEmployeeModel = new JSONModel({ isVisible: false });
                    oView.setModel(oEmployeeModel, "employeeInfo");
                    
                    oView.addStyleClass("zhrjhahsecid-app");
                    document.body.classList.add("zhrjhahsecid-app");

                    oView.addEventDelegate({
                        onAfterRendering: function () {
                            try {
                                var $view = oView.$();

                                // 1. INSTANT TYPING LISTENER
                                if (!$view.data("payrollIdEventAttached")) {
                                    var timeoutId = null; 
                                    $view.on("input.payrollIdListener", "input", function(oEvent) {
                                        var oInputControl = Element.closestTo(oEvent.target);
                                        if (!oInputControl) return;

                                        var bIsTargetField = false;
                                        var oCurrentNode = oInputControl;
                                        
                                        while (oCurrentNode && typeof oCurrentNode.getParent === "function") {
                                            var sId = (oCurrentNode.getId() || "").toUpperCase();
                                            var sBindingPath = "";
                                            if (typeof oCurrentNode.getBindingPath === "function") {
                                                sBindingPath = (oCurrentNode.getBindingPath("value") || "").toUpperCase();
                                            }
                                            
                                            if (sId.indexOf("PAYROLLNUM") !== -1 || sBindingPath.indexOf("PAYROLLNUM") !== -1) {
                                                bIsTargetField = true; break;
                                            }
                                            oCurrentNode = oCurrentNode.getParent();
                                        }

                                        if (bIsTargetField) {
                                            var sVal = oEvent.target.value; 
                                            if (timeoutId) clearTimeout(timeoutId);
                                            if (!sVal || sVal.trim() === "") {
                                                oExtension._fetchEmployeeDetails("");
                                            } else {
                                                if (sVal !== oExtension._sLatestRequestedId) {
                                                    var oEmpModel = oView.getModel("employeeInfo");
                                                    if (oEmpModel) {
                                                        oEmpModel.setData({ isVisible: false });
                                                        oEmpModel.refresh(true);
                                                    }
                                                }
                                                timeoutId = setTimeout(function() {
                                                    oExtension._fetchEmployeeDetails(sVal);
                                                }, 500);
                                            }
                                        }
                                    });
                                    $view.data("payrollIdEventAttached", true);
                                }

                                // 2. ASTERISKS & MESSAGES
                                if (!$view.data("dynamicUIFeaturesAttached")) {
                                    setInterval(function() {
                                        try {
                                            var $editableInputs = $view.find(".sapMInputBaseInner:not([readonly])");
                                            var bIsEditMode = $editableInputs.length > 0;

                                            var toggleAsterisk = function(sLabelText, bMandatory) {
                                                if (!bIsEditMode) bMandatory = false;

                                                $view.find("label, .sapMLabel").each(function() {
                                                    var $label = $(this);
                                                    var rawText = $label.text().replace(/\*/g, '').trim();
                                                    
                                                    if (rawText === sLabelText || rawText === sLabelText + ":") {
                                                        var $ast = $label.find(".customRedAsterisk");
                                                        if (bMandatory) {
                                                            if ($ast.length === 0) $label.append("<span class='customRedAsterisk' style='color:#b02323; font-weight:bold; margin-left:3px;'>*</span>");
                                                        } else {
                                                            $ast.remove(); 
                                                        }
                                                    }
                                                });
                                            };

                                            toggleAsterisk("Payroll Number", true);
                                            toggleAsterisk("Request Type", true);

                                            $view.find(".sapMTitle span:contains('Attachments')").each(function() {
                                                var $title = $(this);
                                                var rawText = $title.text().split('*')[0].trim();
                                                
                                                if (rawText.indexOf("Attachments") === 0) {
                                                    var $ast = $title.find(".customRedAsterisk");
                                                    var $toolbar = $title.closest('.sapMTB, .sapMListHdr');
                                                    var $note = $toolbar.prev('.evidenceNoteMsg');

                                                    if (bIsEditMode) {
                                                        if ($ast.length === 0) $title.append("<span class='customRedAsterisk' style='color:#b02323; font-weight:bold; margin-left:4px;'>*</span>");
                                                        if ($toolbar.length > 0 && $note.length === 0) {
                                                            $toolbar.before("<div class='evidenceNoteMsg' style='color: #6a6d70; font-size: 0.875rem; font-style: italic; padding-bottom: 0.75rem; padding-left: 1rem;'>(Please note: A minimum of one supporting evidence file is required to submit a request.)</div>");
                                                        }
                                                    } else {
                                                        $ast.remove();
                                                        $note.remove();
                                                    }
                                                }
                                            });

                                        } catch (err) {}
                                    }, 500); 

                                    $view.data("dynamicUIFeaturesAttached", true);
                                }

                            } catch (err) { console.error("Error in onAfterRendering:", err); }
                        }
                    }); 
                } catch (err) { console.error("Error in onInit override:", err); }
            },

            routing: {
                onAfterBinding: function (oBindingContext) {
                    var oView = this.base.getView();
                    var oAppModel = oView.getModel();
                    if (!oAppModel) return;

                    var oEmployeeModel = oView.getModel("employeeInfo");
                    if (!oEmployeeModel) {
                        oEmployeeModel = new JSONModel({ isVisible: false });
                        oView.setModel(oEmployeeModel, "employeeInfo");
                    }

                    // ------------------------------------------------------------
                    // ROLE-BASED AUTH CHECK (Security vs Employee/HR)
                    // ------------------------------------------------------------
                    if (!this._bAuthChecked) {
                        this._bAuthChecked = true;
                        try {
                            var oListBinding = oAppModel.bindList("/authInfo", null, null, null, { $$groupId: "$direct" });
                            oListBinding.requestContexts(0, 1).then(function (aContexts) {
                                if (aContexts && aContexts.length > 0) {
                                    var oUserData = aContexts[0].getObject();
                                    var sRole = (oUserData.ROLE || "").toUpperCase();

                                    if (sRole === "ADMIN") {
                                        // Security Admin Mode
                                        oView.addStyleClass("securityMode");
                                        document.body.classList.add("securityMode");
                                        oView.removeStyleClass("employeeMode");
                                        document.body.classList.remove("employeeMode");
                                    } else {
                                        // HR / Employee Mode
                                        oView.addStyleClass("employeeMode");
                                        document.body.classList.add("employeeMode");
                                        oView.removeStyleClass("securityMode");
                                        document.body.classList.remove("securityMode");
                                    }
                                }
                            }).catch(function (err) {
                                console.log("Auth fetch failed:", err);
                            });
                        } catch (e) {
                            console.log("Skipping Auth check.");
                        }
                    }

                    if (oBindingContext && oBindingContext.getPath().indexOf("/Header") !== -1) {
                        oBindingContext.requestProperty("PayrollNum").then(function (sPayrollNum) {
                            this._fetchEmployeeDetails(sPayrollNum);
                        }.bind(this)).catch(function(err) {
                            if (oEmployeeModel) {
                                oEmployeeModel.setData({ isVisible: false });
                                oEmployeeModel.refresh(true);
                            }
                        });

                        if (this._oPayrollBinding) {
                            this._oPayrollBinding.detachChange(this._onPayrollModelChanged, this);
                            this._oPayrollBinding.destroy(); 
                        }
                        this._oPayrollBinding = oAppModel.bindProperty("PayrollNum", oBindingContext);
                        this._oPayrollBinding.attachChange(this._onPayrollModelChanged, this);
                    }
                }
            }
        }
    });
});