sap.ui.define([], function () {
  "use strict";

  function pad(iValue) {
    return String(iValue).padStart(2, "0");
  }

  return {
    /**
     * Formats a backend date string "YYYYMMDD" (Edm.String) as "DD/MM/YYYY".
     * Values in any other shape are returned unchanged.
     */
    yyyymmddToDisplay: function (sValue) {
      var s = String(sValue || "").trim();
      if (/^\d{8}$/.test(s)) {
        return s.substring(6, 8) + "/" + s.substring(4, 6) + "/" + s.substring(0, 4);
      }
      return s;
    },

    /** "13:30:00" -> "1:30 PM" */
    time12h: function (sTime) {
      if (!sTime) {
        return "";
      }
      var aParts = String(sTime).split(":");
      var iHours = parseInt(aParts[0], 10);
      var sSuffix = iHours >= 12 ? "PM" : "AM";
      iHours = iHours % 12 || 12;
      return iHours + ":" + (aParts[1] || "00") + " " + sSuffix;
    },

    /** Local Date -> "YYYY-MM-DD" (Edm.Date model format) */
    toEdmDate: function (oDate) {
      if (!oDate) {
        return null;
      }
      return oDate.getFullYear() + "-" + pad(oDate.getMonth() + 1) + "-" + pad(oDate.getDate());
    },

    /** "YYYY-MM-DD" -> local Date (no timezone shift) */
    fromEdmDate: function (sDate) {
      var a = String(sDate || "").split("-");
      if (a.length !== 3) {
        return null;
      }
      return new Date(parseInt(a[0], 10), parseInt(a[1], 10) - 1, parseInt(a[2], 10));
    }
  };
});
