# Releasing

There're no hard rules about when to release this project. Release bug fixes frequently, features not so frequently and breaking API changes rarely.

### Release

Run tests, check that all tests succeed locally.

```
npm run test
```

Update "X.Y.Z (Next)" in [CHANGELOG.md](CHANGELOG.md) with an actual date.

```
### 3.1.0 (2022/10/25)
```

Remove the line with "Your contribution here.", since there will be no more contributions to this release.

Commit your changes and create a tag.

```
git add CHANGELOG.md
git commit -m "Preparing for release, 3.1.0."
git tag v3.1.0
git push origin main --tags
```

This will trigger [a release publish workflow](.github/workflows/publish.yml) and make the release.

### Prepare for the Next Development Iteration

Add the next patch release number per semver to [CHANGELOG.md](CHANGELOG.md).

```
### 3.1.1 (Next)
================

* Your contribution here.
```

Commit your changes.

```
git add CHANGELOG.md
git commit -m "Preparing for next development iteration, 3.1.1."
git push origin main
```
