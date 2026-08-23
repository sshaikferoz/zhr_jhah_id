sap.ui.define([
    "sap/ui/core/mvc/ControllerExtension",
    "sap/ui/core/Element",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "sap/m/Input",
    "sap/m/DatePicker",
    "sap/ui/layout/form/FormElement",
    "sap/m/Label",
    "sap/m/Select",
    "sap/ui/core/Item"
], function (ControllerExtension, Element, JSONModel, Fragment, MessageToast, Input, DatePicker, FormElement, Label, Select, Item) {
    "use strict";

    return ControllerExtension.extend("com.jhah.zhrjhahsecid.ext.controller.ObjectPageExt", {
        
        _sLatestRequestedId: null, 
        _oPayrollBinding: null,     

        // ============================================================
        // 1. EMPLOYEE DETAILS LIVE FETCH (OData V4 Safe Filter)
        // ============================================================
        _fetchEmployeeDetails: function (sPayrollNum) {
            var oView = this.base.getView();
            var oAppModel = oView.getModel();
            var oEmployeeModel = oView.getModel("employeeInfo");
            
            if (!oAppModel || !oEmployeeModel) return;

            var sCleanId = (sPayrollNum || "").trim();
            if (!sCleanId || sCleanId === "0" || sCleanId === "") {
                if (this._sLatestRequestedId !== "0") {
                    this._sLatestRequestedId = "0";
                    oEmployeeModel.setData({ isVisible: false });
                    oEmployeeModel.refresh(true);
                }
                return;
            }

            if (this._sLatestRequestedId === sCleanId) return; 
            this._sLatestRequestedId = sCleanId; 

            // Query using $filter to avoid 404 popups when a non-existent ID is typed
            var oListBinding = oAppModel.bindList("/EmployeeDetails", null, null, [
                new sap.ui.model.Filter("Pernr", sap.ui.model.FilterOperator.EQ, sCleanId)
            ], { $$groupId: "$direct" });

            oListBinding.requestContexts(0, 1).then(function(aContexts) {
                if (this._sLatestRequestedId !== sCleanId) return;
                
                if (aContexts && aContexts.length > 0) { 
                    var oData = aContexts[0].getObject();
                    oEmployeeModel.setData(Object.assign({}, oData, { isVisible: true })); 
                } else { 
                    // Clear data cleanly if employee is not found
                    oEmployeeModel.setData({ isVisible: false }); 
                }
                oEmployeeModel.refresh(true); 
            }.bind(this)).catch(function(oError) {
                if (this._sLatestRequestedId !== sCleanId) return; 
                oEmployeeModel.setData({ isVisible: false });
                oEmployeeModel.refresh(true); 
            }.bind(this));
        },

        _onPayrollModelChanged: function (oEvent) {
            var sNewVal = oEvent.getSource().getValue();
            this._fetchEmployeeDetails(sNewVal);
        },

        // ============================================================
        // 2. ROLE & PERSONA AUTHENTICATION CHECK
        // ============================================================
        _checkAndApplyRoleAuth: function(oAppModel) {
            if (window._jhahAuthChecked) return;
            window._jhahAuthChecked = true;
            
            var oExtension = this;

            var applyMode = function(sMode) {
                document.body.classList.remove("employeeMode", "securityMode", "hrMode");
                document.body.classList.add(sMode);

                // Only load the Active ID Card in List Report if the user is NOT Security/Admin
                if (sMode !== "securityMode") {
                    oExtension._loadActiveIDAndFragment();
                }
            };

            var sUserId = "UNKNOWN";
            try {
                if (sap.ushell && sap.ushell.Container) {
                    sUserId = sap.ushell.Container.getService("UserInfo").getId().toUpperCase().trim();
                }
            } catch (e) {}

            // Hardcoded check for testing personas
            if (sUserId === "SAKKARSAX") { applyMode("securityMode"); return; } 
            else if (sUserId === "DHINESDHX") { applyMode("employeeMode"); return; } 
            else if (sUserId === "TEST_HR2.5") { applyMode("hrMode"); return; }

            // Backend fallback check via /authInfo
            try {
                var oListBinding = oAppModel.bindList("/authInfo", null, null, null, { $$groupId: "$direct" });
                oListBinding.requestContexts(0, 1).then(function (aContexts) {
                    if (aContexts && aContexts.length > 0) {
                        var oUserData = aContexts[0].getObject();
                        var sRole = (oUserData.ROLE || "").toUpperCase().trim();
                        if (sRole === "ADMIN" || sRole === "SECURITY") { applyMode("securityMode"); } 
                        else if (sRole === "HR" || sRole === "HRADMIN") { applyMode("hrMode"); }
                        else { applyMode("employeeMode"); }
                    } else { applyMode("employeeMode"); }
                }).catch(function () { applyMode("employeeMode"); });
            } catch (e) { applyMode("employeeMode"); }
        },

        // ============================================================
        // 3. TIME FORMATTER & CONTEXT PROPERTY INJECTOR
        // ============================================================
        _formatTime12h: function (sTime) {
            if (!sTime) return "";
            var aParts = sTime.split(":");
            var iHours = parseInt(aParts[0], 10);
            var sMins = aParts[1];
            var sAmPm = iHours >= 12 ? "PM" : "AM";
            iHours = iHours % 12;
            iHours = iHours ? iHours : 12; 
            return iHours + ":" + sMins + " " + sAmPm;
        },

        _setSafeProperty: function(oContext, sKeyword, sValue, bOnlyIfNull) {
            if (!oContext) return;
            var oData = oContext.getObject() || {};
            
            // Search exact OData property name (case-insensitive)
            var sExactKey = Object.keys(oData).find(function(k) {
                return k.toLowerCase().replace(/[^a-z0-9]/g, '') === sKeyword.toLowerCase().replace(/[^a-z0-9]/g, '');
            });
            
            var sFinalKey = sExactKey || sKeyword; 
            
            if (bOnlyIfNull) {
                var currentVal = oContext.getProperty(sFinalKey);
                if (currentVal !== null && currentVal !== undefined && currentVal !== "") return; 
            }
            oContext.setProperty(sFinalKey, sValue);
        },

        // ============================================================
        // 4. RENEW BUTTON ENABLEMENT & TOOLTIP HANDLER
        // ============================================================
        _updateRenewButtonState: function () {
            var oView = this.base.getView();
            var oActiveIdModel = oView.getModel("activeIDModel");
            var bIsEligible = false;
            
            if (oActiveIdModel) {
                var oData = oActiveIdModel.getData() || {};
                if (oData.IdNumber && oData.IsExpiringSoon) {
                    bIsEligible = true;
                }
            }

            var fnUpdate = function() {
                var aButtons = oView.findAggregatedObjects(true, function(o) {
                    return o.isA("sap.m.Button") && (o.getText() === "Renew ID Card" || (o.getId && o.getId().indexOf("renewID") !== -1));
                });
                
                aButtons.forEach(function(oBtn) {
                    oBtn.setEnabled(bIsEligible); 
                    if (bIsEligible) {
                        oBtn.setTooltip("Your ID is eligible for renewal.");
                    } else {
                        oBtn.setTooltip("Renewal is available within 30 days of your ID expiration.");
                    }
                });
            };
            
            fnUpdate();
            setTimeout(fnUpdate, 500);
            setTimeout(fnUpdate, 1500);
        },

        // ============================================================
        // 5. ACTIVE ID CARD LIST REPORT INJECTION
        // ============================================================
        _loadActiveIDAndFragment: function () {
            var oView = this.base.getView();
            var oPage = oView.getContent()[0];

            if (!oPage || !oPage.isA("sap.f.DynamicPage")) return;
            var oHeader = oPage.getHeader();
            if (!oHeader) return;

            var oModel = oView.getModel();
            if (!oModel) {
                setTimeout(this._loadActiveIDAndFragment.bind(this), 200);
                return;
            }

            var oBinding = oModel.bindList("/activeID", null, null, null, { $$groupId: "$direct" });

            oBinding.requestContexts(0, 1).then(function (aContexts) {
                if (!aContexts || aContexts.length === 0) {
                    return; 
                }

                var oData = aContexts[0].getObject();
                var iDays = parseInt(oData.DaystoExpire, 10);
                oData.IsExpiringSoon = !isNaN(iDays) && iDays <= 30;

                var oActiveIdModel = new JSONModel(oData);
                oView.setModel(oActiveIdModel, "activeIDModel");
                this._updateRenewButtonState();

                var sFragmentId = oView.getId() + "--myActiveIDCard";
                if (sap.ui.core.Element.registry.get(sFragmentId)) return;

                Fragment.load({
                    id: sFragmentId, 
                    name: "com.jhah.zhrjhahsecid.ext.fragment.ActiveIdCard",
                    controller: this
                }).then(function (oFragment) {
                    oHeader.insertContent(oFragment, 0); 
                });

            }.bind(this)).catch(function () {
                this._updateRenewButtonState();
            }.bind(this));
        },

        // ============================================================
        // 6. APPOINTMENT SLOTS DATA LOADER & INLINE INTEGRATION
        // ============================================================
        _loadAllAppointmentSlots: function () {
            var oView = this.base.getView();
            var oSlotModel = oView.getModel("apptslots");
            
            if (!oSlotModel) {
                oSlotModel = new JSONModel({ dates: [], slotsByDate: {}, minDate: null, maxDate: null, currentSlots: [], selectedKey: "", selectedLabel: "" });
                oView.setModel(oSlotModel, "apptslots");
            } else {
                oSlotModel.setProperty("/selectedKey", "");
                oSlotModel.setProperty("/selectedLabel", "");
                oSlotModel.setProperty("/currentSlots", []);
                if (this._oCustomSlotInput) this._oCustomSlotInput.setValue("");
            }

            var oAppModel = oView.getModel();
            var oListBinding = oAppModel.bindList("/Appslots", null, null, null, { $$groupId: "$direct" });
            
            oListBinding.requestContexts(0, 1000).then(function (aContexts) {
                var mByDate = {};
                var aDates = [];
                var oExtension = this;

                aContexts.forEach(function (oCtx) {
                    var oSlot = oCtx.getObject();
                    var sDate = oSlot.AppointmentDate;
                    if (!sDate) return;
                    
                    if (!mByDate[sDate]) {
                        mByDate[sDate] = [];
                        aDates.push(sDate);
                    }
                    
                    var sFromFormat = oExtension._formatTime12h(oSlot.FromTime);
                    var sToFormat = oExtension._formatTime12h(oSlot.ToTime);
                    
                    var iCapacity = parseInt(oSlot.Capacity, 10) || 0;
                    var iBooked = parseInt(oSlot.Booked, 10) || 0;
                    var iBucket = 0; 
                    if (iCapacity > 0) {
                        var iPercent = Math.round((iBooked / iCapacity) * 100);
                        iBucket = Math.round(iPercent / 10) * 10; 
                        if (iBucket > 100) iBucket = 100;
                    }
                    
                    mByDate[sDate].push({
                        key: oSlot.SlotId + "#" + oSlot.FromTime,
                        SlotId: oSlot.SlotId,
                        FromTime: oSlot.FromTime,
                        ToTime: oSlot.ToTime,
                        full: iCapacity > 0 && iBooked >= iCapacity,
                        rangeLabel: sFromFormat + " - " + sToFormat,
                        bucket: iBucket 
                    });
                });

                aDates.sort();
                Object.keys(mByDate).forEach(function (sKey) {
                    mByDate[sKey].sort(function (a, b) { return a.FromTime < b.FromTime ? -1 : (a.FromTime > b.FromTime ? 1 : 0); });
                });

                oSlotModel.setProperty("/dates", aDates);
                oSlotModel.setProperty("/slotsByDate", mByDate);

                if (aDates.length > 0) {
                    var minParts = aDates[0].split("-");
                    var maxParts = aDates[aDates.length - 1].split("-");
                    oSlotModel.setProperty("/minDate", new Date(parseInt(minParts[0], 10), parseInt(minParts[1], 10) - 1, parseInt(minParts[2], 10)));
                    oSlotModel.setProperty("/maxDate", new Date(parseInt(maxParts[0], 10), parseInt(maxParts[1], 10) - 1, parseInt(maxParts[2], 10)));
                }
            }.bind(this));
        },

        _getSafeSelectedDate: function() {
            // 1. Try Custom Dialog DatePicker first if visible
            if (this._oCustomDatePicker && this._oCustomDatePicker.getVisible && this._oCustomDatePicker.getVisible()) {
                var oDate = this._oCustomDatePicker.getDateValue();
                if (oDate) {
                    var y = oDate.getFullYear(), m = oDate.getMonth() + 1, d = oDate.getDate();
                    return y + "-" + (m < 10 ? "0" + m : m) + "-" + (d < 10 ? "0" + d : d);
                }
            }
            // 2. Try OData context (for Inline Fiori Elements)
            var oCtx = this._oActionContext || this.base.getView().getBindingContext();
            if (oCtx) {
                var sDate = oCtx.getProperty("ApptDate") || oCtx.getProperty("appointmentdate");
                if (sDate) {
                    return sDate.split("T")[0]; // Safeguard for strict YYYY-MM-DD
                }
            }
            return null;
        },

        onAppointmentDateChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var bValid = oEvent.getParameter("valid");
            var oExtension = this;
            
            // Timeout ensures the standard Fiori Element model updates before we read it
            setTimeout(function() {
                var oSlotModel = oExtension.base.getView().getModel("apptslots");
                oExtension._oActionContext = oExtension._oActionContext || oExtension.base.getView().getBindingContext();
                
                var sDate = oExtension._getSafeSelectedDate();
                var mByDate = oSlotModel.getProperty("/slotsByDate") || {};
                var aSlots = (sDate && mByDate[sDate]) || [];
                
                oSlotModel.setProperty("/currentSlots", aSlots);
                oSlotModel.setProperty("/selectedKey", "");
                oSlotModel.setProperty("/selectedLabel", "");
                
                if (oExtension._oCustomSlotInput) { oExtension._oCustomSlotInput.setValue(""); }

                // Map exactly to OData properties
                oExtension._setSafeProperty(oExtension._oActionContext, "appointmentfrom", "00:00:00");
                oExtension._setSafeProperty(oExtension._oActionContext, "appointmentto", "00:00:00");
                oExtension._setSafeProperty(oExtension._oActionContext, "slotid", "");

                if (!bValid || (sDate && aSlots.length === 0)) {
                    if (typeof oSource.setValueState === "function") {
                        oSource.setValueState("Error");
                        oSource.setValueStateText("Please select an available appointment date.");
                    }
                } else {
                    if (typeof oSource.setValueState === "function") {
                        oSource.setValueState("None");
                        oSource.setValueStateText("");
                    }
                }
            }, 50);
        },

        onAppointmentSlotValueHelp: function () {
            var oView = this.base.getView();
            this._oActionContext = this._oActionContext || oView.getBindingContext();
            var sDate = this._getSafeSelectedDate();
            
            if (!sDate) {
                MessageToast.show("Please select an Appointment Date first to view slots.");
                return;
            }

            var oSlotModel = oView.getModel("apptslots");
            var mByDate = oSlotModel.getProperty("/slotsByDate") || {};
            oSlotModel.setProperty("/currentSlots", mByDate[sDate] || []);

            var sPopoverId = oView.getId() + "--slotPopover";
            
            if (!this._pSlotPopover) {
                var oExisting = sap.ui.core.Element.registry.get(sPopoverId);
                if (oExisting) oExisting.destroy();

                this._pSlotPopover = Fragment.load({
                    id: sPopoverId,
                    name: "com.jhah.zhrjhahsecid.ext.fragment.TimeSlotPopover",
                    controller: this
                }).then(function (oPopover) {
                    oView.addDependent(oPopover);
                    return oPopover;
                });
            }

            this._pSlotPopover.then(function (oPopover) {
                if (this._oCustomSlotInput) {
                    oPopover.openBy(this._oCustomSlotInput);
                }
            }.bind(this));
        },

        onAppointmentSlotPress: function (oEvent) {
            var oButton = oEvent.getSource();
            var oView = this.base.getView();
            var oSlotModel = oView.getModel("apptslots");
            
            var oItemContext = oButton.getBindingContext("apptslots");
            var oSlot = oItemContext.getObject();

            if (!oSlot || !this._oActionContext) return;

            oSlotModel.setProperty("/selectedKey", oSlot.key);
            oSlotModel.setProperty("/selectedLabel", oSlot.rangeLabel);

            if (this._oCustomSlotInput) {
                this._oCustomSlotInput.setValue(oSlot.rangeLabel);
            }

            // Map exactly to OData properties
            this._setSafeProperty(this._oActionContext, "appointmentfrom", oSlot.FromTime);
            this._setSafeProperty(this._oActionContext, "appointmentto", oSlot.ToTime);
            this._setSafeProperty(this._oActionContext, "slotid", oSlot.SlotId);

            this.onAppointmentSlotPopoverCancel();
        },

        onAppointmentSlotPopoverCancel: function () {
            if (this._pSlotPopover) {
                this._pSlotPopover.then(function (oPopover) {
                    oPopover.close();
                });
            }
        },

        // ============================================================
        // 7. LIVE UI VALIDATIONS, RESTRICTORS & DYNAMIC ASTERISKS
        // ============================================================
        _applyUIEnhancements: function() {
            var oExtension = this;
            var oView = this.base.getView();
            var $view = oView.$();
            var oContext = oView.getBindingContext();

            if ($view.length === 0) {
                setTimeout(this._applyUIEnhancements.bind(this), 200);
                return;
            }

            // --- A. STRICT INPUT RESTRICTORS & LIVE KEYSTROKE FEEDBACK ---
            if (!$view.data("inputRestrictorsAttached")) {
                
                // Active typing blocker (removes invalid chars instantly + shows error inline)
                $view.on("input", "input", function (oEvent) {
                    var oInputControl = Element.closestTo(oEvent.target);
                    if (!oInputControl || typeof oInputControl.getBindingPath !== "function") return;

                    var sPath = "";
                    ["value", "conditions", "selectedKey"].forEach(function(prop) {
                        if (!sPath) sPath = oInputControl.getBindingPath(prop) || "";
                    });
                    sPath = sPath.toLowerCase();
                    if (!sPath) return;

                    // Phone Number: Max 10 digits, Numeric only
                    if (sPath.indexOf("phonenum") !== -1) {
                        var sVal = oEvent.target.value;
                        var bHasLetters = /\D/.test(sVal);
                        var sClean = sVal.replace(/\D/g, ''); 
                        
                        if (sClean.length > 10) sClean = sClean.substring(0, 10);
                        
                        if (sVal !== sClean) {
                            oEvent.target.value = sClean;
                            oInputControl.setValue(sClean);
                        }

                        if (bHasLetters) {
                            if (typeof oInputControl.setValueState === "function") {
                                oInputControl.setValueState("Error");
                                oInputControl.setValueStateText("Only numeric digits are allowed here.");
                                setTimeout(function() {
                                    if (oInputControl && !oInputControl.bIsDestroyed) {
                                        oInputControl.setValueState("None");
                                        oInputControl.setValueStateText("");
                                    }
                                }, 3500);
                            }
                        }
                    }
                    // Payroll Number: Max 8 digits, Numeric only
                    else if (sPath.indexOf("payrollnum") !== -1 || sPath.indexOf("pernr") !== -1) {
                        var sVal2 = oEvent.target.value;
                        var bHasLetters2 = /\D/.test(sVal2);
                        var sClean2 = sVal2.replace(/\D/g, ''); 
                        
                        if (sClean2.length > 8) sClean2 = sClean2.substring(0, 8);
                        
                        if (sVal2 !== sClean2) {
                            oEvent.target.value = sClean2;
                            oInputControl.setValue(sClean2);
                        }

                        if (bHasLetters2) {
                            if (typeof oInputControl.setValueState === "function") {
                                oInputControl.setValueState("Error");
                                oInputControl.setValueStateText("Only numeric digits are allowed here.");
                                setTimeout(function() {
                                    if (oInputControl && !oInputControl.bIsDestroyed) {
                                        oInputControl.setValueState("None");
                                        oInputControl.setValueStateText("");
                                    }
                                }, 3500);
                            }
                        }
                    }
                    // Email ID: Broadly block all spaces and invalid symbols immediately
                    else if (sPath.indexOf("emailid") !== -1) {
                        var sVal3 = oEvent.target.value;
                        var bHasInvalidEmailChars = /[^a-zA-Z0-9.\-@_+]/g.test(sVal3);
                        
                        if (bHasInvalidEmailChars) {
                            var sClean3 = sVal3.replace(/[^a-zA-Z0-9.\-@_+]/g, '');
                            if (sVal3 !== sClean3) {
                                oEvent.target.value = sClean3;
                                oInputControl.setValue(sClean3);
                            }
                            
                            if (typeof oInputControl.setValueState === "function") {
                                oInputControl.setValueState("Error");
                                oInputControl.setValueStateText("Special characters and spaces are not permitted in email addresses.");
                                setTimeout(function() {
                                    if (oInputControl && !oInputControl.bIsDestroyed) {
                                        oInputControl.setValueState("None");
                                        oInputControl.setValueStateText("");
                                    }
                                }, 3500);
                            }
                        }
                    }
                });

                // --- B. ON CHANGE / BLUR VALIDATION (Format, Length, Domains) ---
                $view.on("change focusout", "input", function (oEvent) {
                    var oInputControl = Element.closestTo(oEvent.target);
                    if (!oInputControl || typeof oInputControl.getBindingPath !== "function") return;

                    var sPath = "";
                    ["value", "conditions", "selectedKey"].forEach(function(prop) {
                        if (!sPath) sPath = oInputControl.getBindingPath(prop) || "";
                    });
                    sPath = sPath.toLowerCase();
                    if (!sPath) return;

                    var sVal = String(oInputControl.getValue() || "").trim();
                    var bValid = true;
                    var sErrorMsg = "";

                    // EMAIL STRICT VALIDATION
                    if (sPath.indexOf("emailid") !== -1) {
                        if (sVal) {
                            var bStrictFormat = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(sVal);
                            if (!bStrictFormat || sVal.indexOf("//") !== -1 || sVal.indexOf("??") !== -1) {
                                bValid = false;
                                sErrorMsg = "Please enter a valid email format. Special characters and spaces are not permitted.";
                            } else {
                                var aBlockedDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "mail.com", "zoho.com", "proton.me"];
                                var sDomain = sVal.split("@")[1] ? sVal.split("@")[1].toLowerCase() : "";
                                var bIsBlocked = aBlockedDomains.some(function(d) { return sDomain === d || sDomain.endsWith("." + d); });

                                if (bIsBlocked) {
                                    bValid = false;
                                    sErrorMsg = "Personal email domains are not allowed. Please use your official company email.";
                                }
                            }
                        }
                    } 
                    // PHONE NUMBER
                    else if (sPath.indexOf("phonenum") !== -1) {
                        if (sVal) {
                            var sCleanPhone = sVal.replace(/\D/g, '');
                            if (sCleanPhone.length !== 10) {
                                bValid = false;
                                sErrorMsg = "Phone number must be exactly 10 digits.";
                            }
                        }
                    } 
                    // PAYROLL NUMBER
                    else if (sPath.indexOf("payrollnum") !== -1 || sPath.indexOf("pernr") !== -1) {
                        if (sVal) {
                            var sCleanPayroll = sVal.replace(/\D/g, '');
                            if (sCleanPayroll.length !== 8) {
                                bValid = false;
                                sErrorMsg = "Payroll number must be exactly 8 digits.";
                            }
                        }
                    } 
                    // DATE OF BIRTH
                    else if (sPath.indexOf("dob") !== -1) {
                        if (sVal) {
                            var oDate = new Date(sVal);
                            var oToday = new Date();
                            if (oDate > oToday) {
                                bValid = false;
                                sErrorMsg = "Date of Birth cannot be in the future.";
                            } else {
                                var iAge = oToday.getFullYear() - oDate.getFullYear();
                                var m = oToday.getMonth() - oDate.getMonth();
                                if (m < 0 || (m === 0 && oToday.getDate() < oDate.getDate())) iAge--;
                                if (iAge < 18) {
                                    bValid = false;
                                    sErrorMsg = "Employee must be at least 18 years old.";
                                }
                            }
                        }
                    }

                    if (typeof oInputControl.setValueState === "function") {
                        if (!bValid) {
                            oInputControl.setValueState("Error");
                            oInputControl.setValueStateText(sErrorMsg);
                        } else {
                            oInputControl.setValueState("None");
                            oInputControl.setValueStateText("");
                        }
                    }
                });

                $view.data("inputRestrictorsAttached", true);
            }

            // --- C. DYNAMIC ASTERISK & DROPDOWN INJECTOR LOOP ---
            if (!$view.data("dynamicFeaturesAttached")) {
                setInterval(function () {
                    try {
                        var $editableInputs = $view.find(".sapMInputBaseInner:not([readonly])");
                        var bIsEditMode = $editableInputs.length > 0;

                        // Check live state of Area Access Checkbox
                        var bAreaRequested = false;
                        $view.find(".sapMCb").each(function() {
                            var oCb = Element.closestTo(this);
                            if (oCb && typeof oCb.getBindingPath === "function") {
                                var p = (oCb.getBindingPath("selected") || "").toLowerCase();
                                if (p.indexOf("arearequested") !== -1) {
                                    bAreaRequested = oCb.getSelected();
                                }
                            }
                        });

                        // Standard Asterisk Injector for Labels
                        var toggleAsterisk = function (sLabelText, bMandatory) {
                            if (!bIsEditMode) bMandatory = false;

                            $view.find("label, .sapMLabel").each(function () {
                                var $label = $(this);
                                var rawText = $label.text().replace(/\*/g, '').replace(/:/g, '').trim().toLowerCase();
                                
                                if (rawText === sLabelText.toLowerCase()) {
                                    var $ast = $label.find(".customRedAsterisk");
                                    if (bMandatory) {
                                        if ($ast.length === 0) $label.append("<span class='customRedAsterisk' style='color:#ee0000; font-weight:bold; margin-left:3px;'>*</span>");
                                    } else {
                                        $ast.remove();
                                    }
                                }
                            });
                        };

                        toggleAsterisk("Request Type", true);
                        toggleAsterisk("Location", true);
                        toggleAsterisk("Payroll Number", true);
                        toggleAsterisk("Full Name", true);
                        toggleAsterisk("Government ID", true);
                        toggleAsterisk("Date of Birth", true);
                        toggleAsterisk("Blood Group", true);
                        toggleAsterisk("Department", true);
                        toggleAsterisk("Job Title", true);
                        toggleAsterisk("Unit Name", true);
                        toggleAsterisk("Phone Number", true);
                        toggleAsterisk("Email ID", true);
                        toggleAsterisk("Comments / Remarks", true);
                        
                        toggleAsterisk("Area Code", bAreaRequested);
                        toggleAsterisk("Area Name", bAreaRequested);

                        $view.find(".sapMTitle").each(function() {
                            var $title = $(this);
                            var rawText = $title.text().replace(/\*/g, '').trim().toLowerCase();
                            if (rawText.indexOf("requested access area") !== -1 || rawText.indexOf("area access") !== -1 || rawText === "area" || rawText === "areas") {
                                var $ast = $title.find(".customRedAsterisk");
                                if (bIsEditMode && bAreaRequested) {
                                    if ($ast.length === 0) $title.append("<span class='customRedAsterisk' style='color:#ee0000; font-weight:bold; margin-left:4px;'>*</span>");
                                } else {
                                    $ast.remove();
                                }
                            }
                        });

                        // Hardcoded Blood Group Dropdown Injector
                        $view.find("input").each(function () {
                            var oField = Element.closestTo(this);
                            if (!oField || typeof oField.getBindingPath !== "function") return;
                            var sPath = (oField.getBindingPath("value") || "").toLowerCase();
                            
                            if (sPath.indexOf("bloodgroup") !== -1 && !oField.data("bgInjected")) {
                                oField.data("bgInjected", true);
                                var oFormElement = oField.getParent();
                                if (oFormElement && oFormElement.isA("sap.ui.layout.form.FormElement")) {
                                    oField.setVisible(false);
                                    var oSelect = new Select({
                                        selectedKey: "{BloodGroup}",
                                        items: [
                                            new Item({ key: "", text: "Select Blood Group" }),
                                            new Item({ key: "O+", text: "O Positive (O+)" }),
                                            new Item({ key: "O-", text: "O Negative (O-)" }),
                                            new Item({ key: "A+", text: "A Positive (A+)" }),
                                            new Item({ key: "A-", text: "A Negative (A-)" }),
                                            new Item({ key: "B+", text: "B Positive (B+)" }),
                                            new Item({ key: "B-", text: "B Negative (B-)" }),
                                            new Item({ key: "AB+", text: "AB Positive (AB+)" }),
                                            new Item({ key: "AB-", text: "AB Negative (AB-)" })
                                        ]
                                    });
                                    var oBgCtx = oField.getBindingContext();
                                    if(oBgCtx) oSelect.setBindingContext(oBgCtx);
                                    oFormElement.insertField(oSelect, 1);
                                }
                            }
                        });

                    } catch (e) {}
                }, 500);

                $view.data("dynamicFeaturesAttached", true);
            }

            // --- D. INLINE APPOINTMENT SLOT PICKER (Draft/Create Mode Only) ---
            var bIsDraft = oContext && oContext.getProperty("IsActiveEntity") === false;
            
            if (bIsDraft && !$view.data("inlineTimeInjected")) {
                var oApptFromField = null;
                var oApptToField = null;
                var oApptDateField = null;

                $view.find("input").each(function () {
                    var oField = Element.closestTo(this);
                    if (!oField || typeof oField.getBindingPath !== "function") return;
                    var sPath = (oField.getBindingPath("value") || "").toLowerCase();

                    if (sPath.indexOf("appointmentfrom") !== -1) oApptFromField = oField;
                    if (sPath.indexOf("appointmentto") !== -1) oApptToField = oField;
                    if (sPath === "apptdate" || sPath === "appointmentdate" || sPath.indexOf("apptdate") !== -1) {
                        oApptDateField = oField;
                    }
                });

                if (oApptFromField && oApptDateField) {
                    $view.data("inlineTimeInjected", true);
                    oExtension._loadAllAppointmentSlots();

                    var oCustomInput = new Input({
                        placeholder: "Choose a time slot",
                        showValueHelp: true,
                        valueHelpOnly: true,
                        value: "{apptslots>/selectedLabel}",
                        valueHelpRequest: function() {
                            oExtension._oActionContext = oContext;
                            oExtension._oCustomSlotInput = oCustomInput;
                            oExtension.onAppointmentSlotValueHelp();
                        }
                    });
                    
                    oCustomInput.setBindingContext(oContext);

                    // Replace "Appointment From" with our Custom Input
                    var oFromFormElement = oApptFromField.getParent();
                    if (oFromFormElement && oFromFormElement.isA("sap.ui.layout.form.FormElement")) {
                        oApptFromField.setVisible(false);
                        
                        var oLabel = typeof oFromFormElement.getLabelControl === "function" ? oFromFormElement.getLabelControl() : oFromFormElement.getLabel();
                        if (oLabel && typeof oLabel.setText === "function") {
                            oLabel.setText("Appointment Time");
                        }
                        
                        oFromFormElement.insertField(oCustomInput, 1);
                    } else {
                        oApptFromField.setVisible(false);
                        var oFallbackParent = oApptFromField.getParent();
                        if (oFallbackParent && typeof oFallbackParent.addAggregation === "function") {
                            oFallbackParent.addAggregation("items", oCustomInput);
                        }
                    }

                    // Hide "Appointment To" entirely since the slot covers both
                    if (oApptToField) {
                        var oToFormElement = oApptToField.getParent();
                        if (oToFormElement && oToFormElement.isA("sap.ui.layout.form.FormElement")) {
                            oToFormElement.setVisible(false);
                        } else {
                            oApptToField.setVisible(false);
                        }
                    }

                    // Attach change listener to the standard DatePicker to instantly calculate slots
                    if (typeof oApptDateField.attachChange === "function") {
                        oApptDateField.attachChange(function(oEvent) {
                            oExtension._oActionContext = oContext;
                            oExtension._oCustomSlotInput = oCustomInput;
                            oExtension.onAppointmentDateChange(oEvent);
                        });
                    }
                }
            }
        },
        
        override: {
            onInit: function () {
                var oExtension = this;
                var oView = oExtension.base.getView();

                // Style hook for custom CSS scoping
                oView.addStyleClass("zhrjhahsecid-app");
                document.body.classList.add("zhrjhahsecid-app");

                var oAppComponent = sap.ui.core.Component.getOwnerComponentFor(oView);
                var oAppModel = oAppComponent ? oAppComponent.getModel() : oView.getModel();
                if (oAppModel) { oExtension._checkAndApplyRoleAuth(oAppModel); } 

                var oEmployeeModel = new JSONModel({ isVisible: false });
                oView.setModel(oEmployeeModel, "employeeInfo");

                oView.addEventDelegate({
                    onAfterRendering: function () {
                        oExtension._updateRenewButtonState();
                        oExtension._applyUIEnhancements();
                    }
                }, oExtension);

                // ============================================================
                // 8. DIALOG INTERCEPTOR (Safe & Case-Sensitive Aligned)
                // ============================================================
                if (!window._jhahDialogHookSetup) {
                    var fnOriginalOpen = sap.m.Dialog.prototype.open;
                    sap.m.Dialog.prototype.open = function() {
                        var oDialog = this;
                        var sTitle = oDialog.getTitle ? oDialog.getTitle() : "";
                        
                        // ----------------------------------------------------
                        // A. DELETE / CANCEL REQUEST POPUP
                        // ----------------------------------------------------
                        if (sTitle === "Delete") {
                            setTimeout(function() {
                                try {
                                    var bIsMainDelete = false;
                                    var sNewTitle = "Delete";
                                    var oCtx = oExtension.base.getView().getBindingContext();
                                    var bIsDraft = (oCtx && oCtx.getProperty("IsActiveEntity") === false);

                                    var aTexts = oDialog.findAggregatedObjects(true, function(o) { return o.isA("sap.m.Text") || o.isA("sap.m.FormattedText"); });
                                    
                                    aTexts.forEach(function(oText) {
                                        var sText = typeof oText.getText === "function" ? oText.getText() : "";
                                        var sLower = sText.toLowerCase();

                                        if (sLower.indexOf("delete this object") !== -1 || sLower.indexOf("delete the selected") !== -1 || sLower.indexOf("delete object") !== -1) {
                                            bIsMainDelete = true;
                                            if (bIsDraft) {
                                                sNewTitle = "Delete Draft";
                                                oText.setText("Do you want to delete this draft record?");
                                            } else if (sLower.indexOf("selected") !== -1) {
                                                sNewTitle = "Delete/Cancel";
                                                oText.setText("Do you want to delete or cancel the selected requests?");
                                            } else {
                                                sNewTitle = "Delete/Cancel";
                                                oText.setText("Do you want to cancel this request?");
                                            }
                                        }
                                    });

                                    if (bIsMainDelete) {
                                        oDialog.setTitle(sNewTitle);
                                        var aButtons = oDialog.getButtons();
                                        aButtons.forEach(function(oBtn) {
                                            var sBtnText = oBtn.getText();
                                            if (sBtnText === "Delete") { oBtn.setText("Yes"); } 
                                            else if (sBtnText === "Cancel") { oBtn.setText("No"); }
                                        });
                                    }
                                } catch(e) {}
                            }, 50);
                        }

                        // ----------------------------------------------------
                        // B. SCHEDULE / RESCHEDULE POPUP
                        // ----------------------------------------------------
                        if (sTitle.indexOf("chedule Appointment") !== -1) {
                            oExtension._loadAllAppointmentSlots();
                            oDialog.setModel(oView.getModel("apptslots"), "apptslots");

                            setTimeout(function() {
                                try {
                                    var aFormContainers = oDialog.findAggregatedObjects(true, function(o) { return o.isA("sap.ui.layout.form.FormContainer"); });
                                    if (aFormContainers.length === 0) return;
                                    var oFormContainer = aFormContainers[0];
                                    var aFormElements = oFormContainer.getFormElements();
                                    var iDateIndex = -1;

                                    aFormElements.forEach(function(oFE, index) {
                                        var oLabel = oFE.getLabel();
                                        var sLabelText = typeof oLabel === "string" ? oLabel : (oLabel && typeof oLabel.getText === "function" ? oLabel.getText() : "");
                                        var sLower = sLabelText.toLowerCase();

                                        if (sLower.indexOf("to time") !== -1 || sLower.indexOf("from time") !== -1 || sLower.indexOf("slot id") !== -1 || sLower.indexOf("slotid") !== -1) {
                                            oFE.setVisible(false);
                                        }

                                        if (sLower.indexOf("appointment date") !== -1) {
                                            iDateIndex = index;
                                            if (!oFE.data("isCustomized")) {
                                                oFE.data("isCustomized", true);
                                                var aFields = oFE.getFields();
                                                if (aFields.length > 0) {
                                                    oExtension._oActionContext = aFields[0].getBindingContext();
                                                    aFields[0].setVisible(false);
                                                }
                                                
                                                oExtension._setSafeProperty(oExtension._oActionContext, "appointmentfrom", "00:00:00", true);
                                                oExtension._setSafeProperty(oExtension._oActionContext, "appointmentto", "00:00:00", true);
                                                oExtension._setSafeProperty(oExtension._oActionContext, "slotid", "", true);

                                                var sDatePath = "appointmentdate";
                                                if (oExtension._oActionContext) {
                                                    var oDataObj = oExtension._oActionContext.getObject() || {};
                                                    sDatePath = Object.keys(oDataObj).find(function(k){ return k.toLowerCase().indexOf("appointmentdate") !== -1; }) || "appointmentdate";
                                                }

                                                var oCustomDatePicker = new DatePicker({
                                                    value: { path: sDatePath, type: 'sap.ui.model.odata.type.Date', formatOptions: { style: 'medium' } },
                                                    minDate: "{apptslots>/minDate}",
                                                    maxDate: "{apptslots>/maxDate}",
                                                    placeholder: "Choose a date",
                                                    change: oExtension.onAppointmentDateChange.bind(oExtension)
                                                });
                                                if (oExtension._oActionContext) oCustomDatePicker.setBindingContext(oExtension._oActionContext);
                                                
                                                oExtension._oCustomDatePicker = oCustomDatePicker;
                                                oFE.insertField(oCustomDatePicker, 1);
                                            }
                                        }
                                    });

                                    if (iDateIndex !== -1 && !oDialog.data("timeInputInjected")) {
                                        oDialog.data("timeInputInjected", true);

                                        var oCustomInput = new Input({
                                            placeholder: "Choose a time slot",
                                            showValueHelp: true,
                                            valueHelpOnly: true,
                                            value: "{apptslots>/selectedLabel}",
                                            valueHelpRequest: oExtension.onAppointmentSlotValueHelp.bind(oExtension)
                                        });

                                        if (oExtension._oActionContext) {
                                            oCustomInput.setBindingContext(oExtension._oActionContext);
                                        }
                                        oExtension._oCustomSlotInput = oCustomInput;

                                        var oTimeFormElement = new FormElement({
                                            label: new Label({ text: "Appointment Time" }),
                                            fields: [oCustomInput]
                                        });

                                        oFormContainer.insertFormElement(oTimeFormElement, iDateIndex + 1);
                                        
                                        var oSubmitBtn = oDialog.getBeginButton();
                                        if (oSubmitBtn && !oSubmitBtn.data("isGuarded")) {
                                            oSubmitBtn.data("isGuarded", true);
                                            var aHandlers = (oSubmitBtn.mEventRegistry && oSubmitBtn.mEventRegistry.press) ? oSubmitBtn.mEventRegistry.press.slice() : [];
                                            aHandlers.forEach(function(h) { oSubmitBtn.detachPress(h.fFunction, h.oListener); });
                                            
                                            oSubmitBtn.attachPress(function(oEvent) {
                                                var sTimeVal = oExtension._oCustomSlotInput ? oExtension._oCustomSlotInput.getValue() : "";
                                                if (!sTimeVal || sTimeVal.trim() === "") {
                                                    MessageToast.show("Please select an Appointment Time.");
                                                    return; 
                                                }
                                                aHandlers.forEach(function(h) { h.fFunction.call(h.oListener || oSubmitBtn, oEvent); });
                                            });
                                        }
                                    }
                                } catch(e) {}
                            }, 100);
                        }

                        // ----------------------------------------------------
                        // C. ISSUE ID CARD POPUP (Zero-Flicker Synchronous Logic)
                        // ----------------------------------------------------
                        if (sTitle === "Issue ID Card") {
                            var fnProcessIssueIdCard = function() {
                                try {
                                    var aFormContainers = oDialog.findAggregatedObjects(true, function(o) { return o.isA("sap.ui.layout.form.FormContainer"); });
                                    if (aFormContainers.length === 0) return;

                                    var oValidityField = null;
                                    var oActionContext = null;
                                    var oExpiryFE = null; 

                                    aFormContainers[0].getFormElements().forEach(function(oFE) {
                                        var oLabel = oFE.getLabel();
                                        var sLabelText = typeof oLabel === "string" ? oLabel : (oLabel && typeof oLabel.getText === "function" ? oLabel.getText() : "");
                                        var sLower = sLabelText.toLowerCase().replace(/[^a-z ]/g, '').trim(); 
                                        
                                        if (sLower === "validity period" || sLower.indexOf("validity") !== -1) {
                                            var aFields = oFE.getFields();
                                            if (aFields.length > 0) {
                                                oValidityField = aFields[0];
                                                oActionContext = oValidityField.getBindingContext();
                                            }
                                        }
                                        if (sLower === "date" || sLower === "expiry date" || sLower.indexOf("expiry") !== -1) {
                                            oExpiryFE = oFE;
                                        }
                                        if (sLower.replace(/\s/g, '') === "hideexpiry") {
                                            oFE.setVisible(false);
                                        }
                                    });

                                    if (oValidityField && oExpiryFE && !oDialog.data("issueIdBound")) {
                                        oDialog.data("issueIdBound", true);

                                        var fnSetExpiryVisibility = function (bVisible) {
                                            var oExpiryField = oExpiryFE.getFields()[0];
                                            var oExpiryLabel = typeof oExpiryFE.getLabelControl === "function" ? oExpiryFE.getLabelControl() : null;
                                            if (!oExpiryLabel) {
                                                var vFallbackLabel = oExpiryFE.getLabel();
                                                if (vFallbackLabel && typeof vFallbackLabel.setVisible === "function") oExpiryLabel = vFallbackLabel;
                                            }
                                            if (oExpiryField) oExpiryField.setVisible(bVisible);
                                            if (oExpiryLabel) oExpiryLabel.setVisible(bVisible);
                                        };

                                        var fnEvaluateVisibility = function () {
                                            try {
                                                var sVal = "";
                                                if (typeof oValidityField.getValue === "function") sVal = oValidityField.getValue() || "";
                                                if (!sVal && typeof oValidityField.getBindingInfo === "function") {
                                                    var oBindingInfo = oValidityField.getBindingInfo("value") || oValidityField.getBindingInfo("conditions");
                                                    if (oBindingInfo && oBindingInfo.parts && oBindingInfo.parts.length > 0) {
                                                        var sPath = oBindingInfo.parts[0].path;
                                                        var oCtx = oValidityField.getBindingContext();
                                                        if (oCtx && sPath) sVal = oCtx.getProperty(sPath);
                                                    }
                                                }
                                                if (!sVal && typeof oValidityField.getConditions === "function") {
                                                    var aConds = oValidityField.getConditions();
                                                    if (aConds && aConds.length > 0 && aConds[0].values) sVal = aConds[0].values[0];
                                                }

                                                sVal = String(sVal || "").trim().toUpperCase();
                                                var bShowExpiry = (sVal === "OT");
                                                
                                                fnSetExpiryVisibility(bShowExpiry);
                                                var sHidePayload = bShowExpiry ? "" : "X";
                                                oExtension._setSafeProperty(oActionContext, "HideExpiry", sHidePayload);
                                            } catch (e) {}
                                        };

                                        fnEvaluateVisibility();
                                        
                                        if (typeof oValidityField.attachChange === "function") {
                                            oValidityField.attachChange(function () { setTimeout(fnEvaluateVisibility, 150); });
                                        }
                                    } 
                                } catch(e) {}
                            };

                            fnProcessIssueIdCard();
                            setTimeout(fnProcessIssueIdCard, 50);
                        }

                        return fnOriginalOpen.apply(this, arguments);
                    };
                    window._jhahDialogHookSetup = true;
                }
            },

            // ============================================================
            // 9. ROUTING LIFECYCLE
            // ============================================================
            routing: {
                onAfterBinding: function (oBindingContext) {
                    var oView = this.base.getView();
                    var oAppModel = oView.getModel();
                    if (!oAppModel) return;

                    this._checkAndApplyRoleAuth(oAppModel);

                    if (oBindingContext && oBindingContext.getPath().indexOf("/Header") !== -1) {
                        var sPropName = "PayrollNum";
                        oBindingContext.requestProperty(sPropName).then(function (sPayrollNum) {
                            if (!sPayrollNum) { return oBindingContext.requestProperty("Pernr"); }
                            return sPayrollNum;
                        }).then(function(sDataId) { this._fetchEmployeeDetails(sDataId); }.bind(this)).catch(function() {});

                        if (this._oPayrollBinding) {
                            this._oPayrollBinding.detachChange(this._onPayrollModelChanged, this);
                            this._oPayrollBinding.destroy(); 
                        }
                        this._oPayrollBinding = oAppModel.bindProperty(sPropName, oBindingContext);
                        this._oPayrollBinding.attachChange(this._onPayrollModelChanged, this);
                    }
                }
            }
        }
    });
});