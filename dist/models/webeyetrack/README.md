# WebEyeTrack local model assets

This directory is populated by `npm run vendor:webeyetrack`.

Expected runtime assets after provisioning:

- `web/model.json`
- `web/group1-shard1of1.bin`
- `VENDOR.json`

The extension never downloads these files while tracking. Provision them once
during development and package them with the extension.
