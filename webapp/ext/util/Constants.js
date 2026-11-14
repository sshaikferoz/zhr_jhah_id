sap.ui.define([], function () {
  "use strict";

  /**
   * Constants shared by the app's extension modules.
   *
   * Require it like any other module (no globals):
   *   sap.ui.define(["com/jhah/zhrjhahsecid/ext/util/Constants"], function (Constants) { ... })
   *
   * The object is frozen, so the values cannot be changed at runtime.
   * Model names and CSS classes must stay in sync with manifest.json, the XML fragments
   * and css/custom.css, which reference them by the same strings.
   */

  const APP_ID = "com.jhah.zhrjhahsecid";
  const SERVICE_NAMESPACE = "com.sap.gateway.srvd.zsrv_hr_id_app.v0001";

  return Object.freeze({
    /** sap/base/Log components */
    LOG_COMPONENT: Object.freeze({
      LIST_REPORT: APP_ID + ".ListReportExt",
      OBJECT_PAGE: APP_ID + ".ObjectPageExt",
      ISSUE_ID_DIALOG: APP_ID + ".IssueIdDialog"
    }),

    /** Named models (manifest.json and the extensions' view/dialog models) */
    MODEL: Object.freeze({
      I18N: "i18n",
      UI: "ui", // SAP Fiori elements UI model; only /isEditable is public
      ID_CONFIG: "idConfig",
      ACTIVE_ID: "activeIDModel",
      EMPLOYEE_INFO: "employeeInfo",
      AREA_INFO: "areaInfo",
      ISSUE_ID: "issueId"
    }),

    /** Bound OData actions of the main service */
    ACTION: Object.freeze({
      ISSUE_ID: SERVICE_NAMESPACE + ".IssueID"
    }),

    /** Parameters of the shared configuration service (entity set /config) */
    CONFIG: Object.freeze({
      APP_ID: "ID_APP",
      RENEW_DAYS: "RENEW_DAYS"
    }),

    /** IssueID validity that requires an explicit expiry date */
    VALIDITY_OTHER: "OT",

    /** Roles returned by /authInfo.ROLE */
    BACKEND_ROLE: Object.freeze({
      ADMIN: "ADMIN",
      SECURITY: "SECURITY",
      HR: "HR",
      HR_ADMIN: "HRADMIN"
    }),

    /** UI modes derived from the role; also the CSS classes set on the views */
    MODE: Object.freeze({
      EMPLOYEE: "employeeMode",
      HR: "hrMode",
      SECURITY: "securityMode"
    }),

    /** List Report views (manifest views.paths[].key), in display order */
    TAB_KEY: Object.freeze({
      HR: "HRTabKey",
      ADMIN: "AdminTabKey",
      EMPLOYEE: "EmpTabKey"
    }),

    /** CSS classes put on the views (see css/custom.css) */
    CSS_CLASS: Object.freeze({
      APP: "zhrjhahsecid-app", // scopes generic selectors to this app
      ROLE_LOADING: "jhahRoleLoading",
      OWNERSHIP_LOADING: "loadingOwnershipMode",
      MY_REQUEST: "myRequestMode",
      OTHER_REQUEST: "otherRequestMode",
      DRAFT: "draftMode",
      EDIT: "uiEditMode"
    }),

    /** Number of locked areas named in the "Current Access" strip before "+n more" */
    MAX_LOCKED_AREAS_IN_TEXT: 3,

    MS_PER_DAY: 24 * 60 * 60 * 1000
  });
});
