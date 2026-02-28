# Bug Reporting and Repro Test Cases

Use this guide when you want to report a bug and attach a reproducible history-based test case.

## Where to submit

- Open a GitHub issue: <https://github.com/mmiscool/BREP/issues/new>
- The default bug-report template includes a required snippet section for history-based bugs.
- Use a clear title format, for example: `Extrude: negative distance flips end cap normals`

## What to include in every bug report

- App URL where the issue happened (for example `https://brep.io` or your own deployment).
- Browser and OS (for example `Chrome 123 / macOS 15.2`).
- Exact steps to reproduce, numbered.
- Expected result.
- Actual result.
- Console errors (copy/paste text, not only screenshots).
- Model attachment if relevant (`.BREP.json`, screenshot, or short screen recording).

## Generate a test case with the `🪲` button

1. Open the part where the bug happens.
2. Reproduce the problem so the current history reflects the failing state.
3. Click `🪲` in the CAD toolbar.
4. In the dialog, copy the generated snippet (it is also copied to clipboard automatically when possible).
5. Paste that snippet into your GitHub issue inside a fenced code block.

Example:

```js
// paste generated snippet from the bug button here
```

## Turning a generated snippet into a repo regression test

If you want to contribute a failing test in a PR:

1. Create a new file in `src/tests`, for example `src/tests/test_bug_extrude_face_case.js`.
2. Convert the generated function to an exported test function that accepts `partHistory`.
3. Remove the auto-invocation line at the bottom of the generated snippet.
4. Import and register the test in `src/tests/tests.js`.
5. Run `pnpm test` and include results in your PR.

Minimal shape:

```js
export async function test_bug_extrude_face_case(partHistory) {
  // generated feature creation calls
  partHistory.runHistory();
  return partHistory;
}
```
