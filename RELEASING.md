# Releasing

There're no hard rules about when to release this project. Release bug fixes frequently, features not so frequently and breaking API changes rarely.

### Release

Run tests, check that all tests succeed locally.

```
npm install
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

Create [a new release on GitHub](https://github.com/dblock/create-a-github-issue/releases/new) from a tag.
This will trigger [a release publish workflow](.github/workflows/publish.yml) and make the release.

### Prepare for the Next Development Iteration

Per semver, increment the minor version in [package.json](package.json).

```
"version": "3.1.1"
```

Add the next release number to [CHANGELOG.md](CHANGELOG.md).

```
### 3.1.1 (Next)

* Your contribution here.
```

Commit your changes.

```
npm install
git add package.json package-lock.json CHANGELOG.md
git commit -m "Preparing for next development iteration, 3.1.1."
git push origin main
```
