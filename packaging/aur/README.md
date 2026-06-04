# AUR Packaging

`PKGBUILD.template` is a downstream-maintainer starting point for `laurel-bin`.
Replace `{{VERSION}}`, `{{SHA256_LINUX_X64}}`, and `{{SHA256_LINUX_ARM64}}`
from the GitHub release and its `SHASUMS256.txt` before publishing.

This repository does not publish to the AUR automatically. AUR ownership should
stay with an Arch maintainer who can bump checksums and respond to packaging
feedback.
