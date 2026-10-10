# Releasing

`@rachitkay/proompter` is published to npm from GitHub Actions (`.github/workflows/release.yml`) with npm trusted
publishing: no token is stored anywhere. npm only lets you set that up for a package that already exists, so the
very first publish is manual.

## One-time setup (done for 0.0.1)

0.0.1 was published by hand with `npm publish --access public --provenance=false`; provenance can only be made in
CI. Trusted publishing is set up on npmjs.com → package → **Settings** → **Trusted publishing** → **GitHub Actions**:

- Repository: `rachitkhurana/proompter`
- Workflow: `release.yml`
- Environment name: blank (the workflow uses no GitHub environment; a name here would have to match one)
- Allowed actions: **Allow npm publish** on (the workflow runs `npm publish`), **Allow npm dist-tag** off

## Every release after that

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry. Commit to `main`.
2. Tag and push the tag:

   ```sh
   git tag v0.0.2
   git push origin v0.0.2
   ```

The workflow fails if the tag doesn't match the `package.json` version. Otherwise it runs the checks and
publishes with provenance.
