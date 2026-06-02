# Testing

The Node test runner lives in `src/tests/tests.js`.

Run the full suite:

```bash
pnpm test
```

Run one test by passing its exact registered test function name after `--`:

```bash
pnpm test -- test_primitiveCube
```

The runner also accepts an explicit flag:

```bash
pnpm test -- --test test_primitiveCube
pnpm test -- -t test_primitiveCube
```

Test names are the exported test function names registered in `testFunctions`, plus generated names for dynamic part-file import tests such as `import_part_fillet_test`.

Each run clears `tests/results/` first. A full run writes artifacts for every test that enables them; a single-test run writes only that test's artifacts.
