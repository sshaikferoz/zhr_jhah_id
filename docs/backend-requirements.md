# Backend requirements (RAP service `ZSRV_HR_ID_APP`)

The UI no longer manipulates SAP Fiori elements controls. What it still decides on its own is
listed here, so it can move to the backend where it belongs. Each item says what the UI does
today, what the backend should provide, and what can then be deleted from the app.

## 1. Action availability per role and ownership (blocking: security)

Today: `webapp/css/custom.css`, section **TRANSITIONAL ACTION GATE**, hides buttons by CSS
using view classes set from `/authInfo.ROLE` and `Header.IsMyRequest`. Hiding a button is not
authorization; a user can still call the action.

Needed: RAP **authorization** (`authorization master (global, instance)`) to reject the call,
and **instance feature control** so the UI hides or disables the button by itself
(`Core.OperationAvailable` -> `__OperationControl/<action>`).

| Action | Employee | HR | Security | Own request | Other's request | Draft / editing |
|---|---|---|---|---|---|---|
| `IssueID` | no | no | yes | no | yes | - |
| `CancelRequest` | own only | yes | own only | yes | HR only | no |
| `grantAccess` (Header + AppArea) | no | no | yes | no | yes | - |
| `rejectAccess` (Header + AppArea) | no | no | yes | no | yes | - |
| `schedulePopup` | no | no | yes | no | yes | - |
| `reschedulePopup` | no | no | yes | no | yes | - |
| `rejectAppointment` | no | no | yes | no | yes | - |
| `MarkNoShow` | no | no | yes | no | yes | - |
| `renewID` | no | no | yes | no | yes | - |
| `CreateNewIdReq` (static) | no | yes | no | - | - | - |
| `CreateSelfIdReq` (static) | yes | yes | yes | - | - | - |

(The matrix is exactly what the CSS enforced; please confirm it is the intended business rule.
In particular `renewID` is hidden for employees and on one's own request, which looks unusual.)

Already in place: `OperationAvailable` for `IssueID`, `CancelRequest`, `grantAccess`,
`rejectAccess`. Missing: the appointment actions, `MarkNoShow`, `renewID`
(`Header.enableRenew`, `enableSchedule`, `enableReschedule` exist and are good candidates).

Static actions (`CreateNewIdReq`, `CreateSelfIdReq`) only appear in the tab of the role that
may use them (HR tab / My Requests), so global authorization is sufficient for them.

**Then delete:** the TRANSITIONAL ACTION GATE section in `custom.css`,
`UserRole.applyModeClass` calls in both extensions, and `_applyRecordStateClasses` /
`_bindEditModeClass` in `ObjectPageExt`.

## 2. Role-based List Report tabs

Today: `ListReportExt._applyTabVisibility` hides `HRTabKey` / `AdminTabKey` per role
(SAP Fiori elements has no manifest switch for this).

Options, in order of preference:
1. One launchpad tile per role (target mappings with their own app variant / manifest `views`).
2. Keep the code (it is small, uses public control APIs, and runs once).

## 3. Mandatory fields

Today: `annotations/annotation.xml` marks `LocationID` and `Comments` as mandatory
(`Common.FieldControl`). `ReqType` and `PayrollNum` already use backend feature control.

Needed:
- Feature control `mandatory` for `ReqType`, `PayrollNum` (currently return optional), and a
  path-based `FieldControl` for `SecFileContent` (mandatory when the security upload is shown).
- Validations on save for all of them, plus "request type ACCS requires at least one access
  area" (the UI used to show a red asterisk on the section; this is now a backend message).

**Then delete:** the two local `FieldControl` annotations and the `SecFileContent` asterisk
rule at the end of `custom.css`.

## 4. Employee data for the header strip

Today: `ObjectPageExt._loadEmployee` reads `/EmployeeDetails` filtered by `Pernr` into a JSON
model whenever `PayrollNum` changes.

Needed: an association `Header._Employee` (to `EmployeeDetails` on `PayrollNum = Pernr`) and a
side effect `PayrollNum -> _Employee`. The header fragment can then bind relatively
(`{_Employee/UserName}`) and the loading code disappears.

## 5. Areas held by other requests

Today: `ObjectPageExt._loadExistingAreas` reads `/existingAreas` for the payroll number and
treats rows with another `RequestId` as locked (shown in "Current Access" and kept selected in
the area dialog).

Needed: a navigation (e.g. `Header._lockedAreas`) returning only areas held by *other* requests,
and a validation that rejects adding such an area. The dialog can then filter the value help
on the backend instead of in the UI.

## 6. Config service

`RENEW_DAYS` is read from `zsrv_hr_jhahsec_auth_info/config` (manifest data source
`idConfigService`). Consider exposing the renewal window (or the computed
`IsExpiringSoon` / status) directly on `activeID`, so the List Report card needs no second
service.

## 7. Appointment and renew actions are not exposed

The metadata refreshed on 2026-11-14 (commit `6db4091`) still lists *Schedule Appointment*,
*Reschedule Appointment*, *Reject Appointment* and *Mark No-Show* in `UI.Identification` and
`UI.LineItem#AdminList`, but with `ERROR: Mandatory Value for Action not found`: the actions
are not part of the service projection. `renewID` does not exist either.

The app now overrides both annotations locally (`annotations/annotation.xml`) without these
records. When the actions are exposed again, add them back there (or remove the local
overrides) and give them `Core.OperationAvailable` per section 1. If the time-slot picker is
still wanted, prefer a value list on the slot parameter (`Common.ValueList` on `Appslots`,
filtered by the chosen date) over a custom dialog.

## 8. Issue ID Card

`IssueID(Validity, ExpiryDate, Remarks)` is offered through a custom dialog
(`ext/util/IssueIdDialog.js`) because the standard parameter dialog cannot show the contract
end date or hide `ExpiryDate` unless `Validity = 'OT'`. The backend should validate that
`ExpiryDate` is given exactly when `Validity = 'OT'`. The former `HideExpiry` parameter no
longer exists and is not sent.

## 9. Mock data

Refresh `webapp/localService/mainService/metadata.xml` whenever the service changes
(Fiori tools: *Refresh service metadata*). The config service (`idConfigService`) has no mock,
so the Active ID card stays hidden in `npm run start-mock`.

The repository tracks three value-help metadata files twice with different casing
(`AppAreaType`/`appAreaType`, `HeaderType`/`headerType` under `srvd_f4/`). On macOS (case
insensitive) one of each pair always shows as modified; delete one variant of each in the repo.
