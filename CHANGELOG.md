# Changelog

## [0.8.0](https://github.com/Daemeron/dolq/compare/dolq-v0.7.0...dolq-v0.8.0) (2026-10-29)


### Features

* a random ASCII joke on the splash ([f08d540](https://github.com/Daemeron/dolq/commit/f08d5400d50144f47e0d0e391f3b643d2d7fbaef))
* a splash while Dolq starts, and a window that shows once it has rendered ([9f492c9](https://github.com/Daemeron/dolq/commit/9f492c9eca184e48216d856acaea9307cd376fe8))
* **main:** look for a new version, and fetch and install it on request ([f353cf3](https://github.com/Daemeron/dolq/commit/f353cf311da764a2b337c50a374e3ebb0e0384d4))
* **renderer:** an update notice in the title strip and two switches in Preferences ([107efd1](https://github.com/Daemeron/dolq/commit/107efd18b4a8497ebb286695edc5ae013b8759ab))


### Bug Fixes

* make the splash the size of the window, so nothing jumps when the app shows ([7fa9076](https://github.com/Daemeron/dolq/commit/7fa90767331bf618ed5846f11b824f8af2d573f6))
* **renderer:** round the channel list's bottom-right corner ([8ab8e90](https://github.com/Daemeron/dolq/commit/8ab8e901c3ba4727707caf7dad07f6496fb8fe5b))
* **renderer:** the user panel no longer says Online while the server is not connected ([5606522](https://github.com/Daemeron/dolq/commit/5606522fa75172cdb92192d7528359947a9740ec))

## [0.7.0](https://github.com/Daemeron/dolq/compare/dolq-v0.6.2...dolq-v0.7.0) (2026-10-29)


### Features

**Dashboard** ([#56](https://github.com/Daemeron/dolq/issues/56))

* The Dolq logo, first in the server rail, opens a Dashboard: every server with its status, joined channels (click one to jump to it), current latency and a latency graph over time with min, average and max.
* Latency is measured with a PING/PONG to each server, and live upload and download rates are shown, with a bandwidth graph of the last five minutes (download as a filled area, upload dashed). Transfer speed is measured over a one-second window, so bursts of progress events no longer read as speed spikes.
* The Dashboard hides the channel list and user panel, since it is about all servers.

**A title strip across the whole window** ([#55](https://github.com/Daemeron/dolq/issues/55), [#56](https://github.com/Daemeron/dolq/issues/56))

* A 32px strip above the app holds back and forward navigation through the places you have visited, a title saying where you are, and the app-wide actions: search everywhere, transfers, away on all servers and preferences.
* The window controls live in the strip and follow the theme, on macOS and Windows. They stay the native ones, so Windows 11 snap layouts keep working.
* Hovering Transfers shows what is transferring right now: file, sender, progress and speed.

**Server icons** ([#55](https://github.com/Daemeron/dolq/issues/55))

* Server icons take their colour from the nick palette, the colour can be changed in Edit server (and is kept), and you can pick 2 to 3 letters for the icon.

**Busy channels and the server log** ([#56](https://github.com/Daemeron/dolq/issues/56))

* Runs of three or more joins, leaves, quits and nick changes fold into one line ("nolden, MintCarrot and 2 others joined · warrior left"), with the event count and how long it lasted. Click it to expand the lines in place.
* A new connection is set apart in the server log by a NEW SESSION divider.
* PING and PONG lines are no longer shown or stored in the server log, and the ones already stored are removed once from existing histories.

**File offers** ([#56](https://github.com/Daemeron/dolq/issues/56))

* Accept is now a split button. Its menu picks how to accept (this file only, from the sender for this session, or always), and clicking the button then accepts that way. It replaces the small links in the dialog body.

**Look** ([#56](https://github.com/Daemeron/dolq/issues/56))

* A yellow accent for settings forms (switches, the active tab, focused inputs and their Save and Connect buttons). Everything else keeps the orange.
* New app and tray icons, a yellow tile with a larger dagger. The macOS menu bar keeps its monochrome glyph.
* The download line has its own violet, the backdrop behind dialogs is darker, and the Dolq logo is drawn on transparent instead of on a tile.

### Bug Fixes

* A window frame call missing from an older preload no longer crashes the app ([#55](https://github.com/Daemeron/dolq/issues/55)).
* The member count stays in the Members header ([#55](https://github.com/Daemeron/dolq/issues/55)).
* Answering the server's PING no longer writes it to the log ([#56](https://github.com/Daemeron/dolq/issues/56)).
* Scrolling up through a folded run of joins and quits no longer jumps ([#56](https://github.com/Daemeron/dolq/issues/56)).

### Under the hood

* New README screenshots (including the Dashboard), design-system documentation for the new pieces, and a test run that prints no warnings ([#56](https://github.com/Daemeron/dolq/issues/56)).
* The release pull request now builds the installers for all three platforms and must pass before it can merge ([#57](https://github.com/Daemeron/dolq/issues/57)).

## [0.6.2](https://github.com/Daemeron/dolq/compare/dolq-v0.6.1...dolq-v0.6.2) (2026-10-28)


### Bug Fixes

* **renderer:** draw native controls in the active theme ([#53](https://github.com/Daemeron/dolq/issues/53)) ([a1173e5](https://github.com/Daemeron/dolq/commit/a1173e5f4a49368eda8ffed2426cd548c5454422))

## [0.6.1](https://github.com/Daemeron/dolq/compare/dolq-v0.6.0...dolq-v0.6.1) (2026-10-28)


### Bug Fixes

* **backend:** make the signal test vet-clean on Windows, and vet for Windows in CI ([#50](https://github.com/Daemeron/dolq/issues/50)) ([ee18ade](https://github.com/Daemeron/dolq/commit/ee18ade29f4380e3073383db80520461b9b013bb))

## [0.6.0](https://github.com/Daemeron/dolq/compare/dolq-v0.5.0...dolq-v0.6.0) (2026-10-28)


### Features

* **renderer:** bring every panel to the design ([#48](https://github.com/Daemeron/dolq/issues/48)) ([27eb107](https://github.com/Daemeron/dolq/commit/27eb1079917a4f41ee0633b7cf40cdacb2ac0dc5))


### Bug Fixes

* backend:dev on Windows, and wait for a backend that is not running yet ([#45](https://github.com/Daemeron/dolq/issues/45)) ([aeef443](https://github.com/Daemeron/dolq/commit/aeef443b339a2b86591cca99aa1b7cef02365d5a))
* **main:** give the development backend binary an .exe name on Windows ([#46](https://github.com/Daemeron/dolq/issues/46)) ([39515eb](https://github.com/Daemeron/dolq/commit/39515eb0f71bdec4c196cfb4a4bb924ee36f4b08))
* **renderer:** bring the UI closer to the design (server badge, day dividers, mention highlight, composer, rail and user panel actions) ([#47](https://github.com/Daemeron/dolq/issues/47)) ([f7a7e65](https://github.com/Daemeron/dolq/commit/f7a7e65780934130de4b80d882ec0e6c43550765))

## [0.5.0](https://github.com/Daemeron/dolq/compare/dolq-v0.4.0...dolq-v0.5.0) (2026-10-22)


### Features

* **renderer:** add a connect when the app opens toggle per server ([4ceee18](https://github.com/Daemeron/dolq/commit/4ceee18fa5826c11ee605a18939cc089c8f012ab))
* **renderer:** only connect servers set to connect on startup ([594a082](https://github.com/Daemeron/dolq/commit/594a082d8adedd5d63058363bcd8090ca3c8f908))


### Bug Fixes

* **bouncer:** keep channels across drops and stop stale notices ([99f6db5](https://github.com/Daemeron/dolq/commit/99f6db5a6004c7c2c82aacb57d3a0baf724acf87))
* **bouncer:** let Disconnect settle a drop that is still being handled ([64ee1fb](https://github.com/Daemeron/dolq/commit/64ee1fbd53e7fee71568943ebf0fa58e1f2ff4cf))
* **bouncer:** let Disconnect win against a redial that is finishing ([7caf56a](https://github.com/Daemeron/dolq/commit/7caf56aba5f9d7d3e3bd62d54bce7f25350b0c49))
* **bouncer:** stop an XDCC transfer cancelled before the peer connects ([c64f992](https://github.com/Daemeron/dolq/commit/c64f992cd330e8f18ca42dccfe6bc8fc41678081))
* **dolqd:** refuse plain connections unless asked to allow them ([fdd8800](https://github.com/Daemeron/dolq/commit/fdd8800ed9089665ea21081e9f45cb19acc2cf4e))
* **history:** drop appends that arrive after the store is closed ([4c1ad72](https://github.com/Daemeron/dolq/commit/4c1ad72fa160460955763c4578e92f577992e480))
* **history:** find topics and part/kick/quit reasons in search ([e4afdeb](https://github.com/Daemeron/dolq/commit/e4afdeb0cc31f1fb2a40e7f03dd6ca2d99ff6c6b))
* **history:** search the message text and keep channel lines out of the log ([fe81d4a](https://github.com/Daemeron/dolq/commit/fe81d4ad16539469803e2b21b835b72936608650))
* **input:** bring back a message that failed to send ([4dc3a46](https://github.com/Daemeron/dolq/commit/4dc3a46aaf9f50f29f648a94bbeebc1b1720adc9))
* **ipcproto:** drop a client that stops reading instead of blocking ([79ddbe1](https://github.com/Daemeron/dolq/commit/79ddbe1930496a8b2cc6f14ee71cf9036cc707b9))
* **ipcproto:** keep sends to one server in the order they were typed ([ec17b3a](https://github.com/Daemeron/dolq/commit/ec17b3a2649ac57cb8ed9c2722401712ea8080b4))
* **ircclient:** do not wait for close on a client that never started ([f376147](https://github.com/Daemeron/dolq/commit/f376147d4b87ebc74f346bf77d0e234000e49965))
* **ircclient:** give up on a dial that takes longer than 15 seconds ([1cb8e87](https://github.com/Daemeron/dolq/commit/1cb8e8750b514b2718ec4698fbc2f9f29bfead6f))
* **ircclient:** never miss a close callback registered during the close ([004b2ff](https://github.com/Daemeron/dolq/commit/004b2ff41bf0d63d62a4b21aa7106617fd953b58))
* **ircclient:** report a dropped connection before the close listeners run ([063e4dd](https://github.com/Daemeron/dolq/commit/063e4dddaf5ef061ff0f0e1b4eff7f46446900e2))
* **main:** do not hang on quit when the backend already exited ([5559727](https://github.com/Daemeron/dolq/commit/555972766db695e99c2b00fd9ab68116153ba31f))
* **main:** survive a closed window and redial a dropped remote backend ([7516ab7](https://github.com/Daemeron/dolq/commit/7516ab76be7edd2126771bad0e107766c5e93373))
* **main:** turn on TCP keepalive for the backend connection ([2b822e7](https://github.com/Daemeron/dolq/commit/2b822e7d1c6ae1bb44f20dfd8d4db8d24b5b9016))
* **renderer:** ask for older history on a wheel up at the top ([d86e8d2](https://github.com/Daemeron/dolq/commit/d86e8d282b8c755d2f492b8c02904190a21b4e24))
* **renderer:** attach to every server before reloading history after a redial ([7546926](https://github.com/Daemeron/dolq/commit/7546926b93b070c15e5f6e2c80e7d2eb7c9556ef))
* **renderer:** count unread correctly and alert when it matters ([848f222](https://github.com/Daemeron/dolq/commit/848f222c04b188bfae06f5c6a25d6ad0d769653b))
* **renderer:** fix selection, history, joined state, connect and commands ([b39859a](https://github.com/Daemeron/dolq/commit/b39859a60415c0fc46b69a223710d6a1eeac806e))
* **renderer:** forget how far back history was loaded when a channel closes ([ac6e058](https://github.com/Daemeron/dolq/commit/ac6e058a716bbcdc35cb296e758ab6ae5fa49ef3))
* **renderer:** keep loading the Log until it has lines to scroll ([37e18e9](https://github.com/Daemeron/dolq/commit/37e18e95f0c87e3641ce032a5bcaa9244fb2235e))
* **renderer:** leave a reconnecting server alone after a backend redial ([2ad692f](https://github.com/Daemeron/dolq/commit/2ad692fb60416e88466fa07769709f45f91f1858))
* **renderer:** load older history until the view has something to scroll ([e04064c](https://github.com/Daemeron/dolq/commit/e04064ca1337620e546837065e1defcbfe193451))
* **renderer:** refetch loaded history after the backend link comes back ([d166d5d](https://github.com/Daemeron/dolq/commit/d166d5da4325a388cb3b966a2fec43bb70ce69f5))
* **renderer:** stop loading older pages on its own after 20 in a row ([d80820d](https://github.com/Daemeron/dolq/commit/d80820d906ff25dee17ae75f4cd785f65040f30f))
* **renderer:** stop persisting user lists to localStorage ([695080d](https://github.com/Daemeron/dolq/commit/695080d2c24b7b60a9133c45241725663e33f6b7))
* **renderer:** test the checks that end loading older history ([1684b64](https://github.com/Daemeron/dolq/commit/1684b64803bfe6adaae7b41efedb27a212606e59))

## [0.4.0](https://github.com/Daemeron/dolq/compare/dolq-v0.3.3...dolq-v0.4.0) (2026-10-19)


### Features

* **store:** version the persisted store with migrate-or-flush ([c742113](https://github.com/Daemeron/dolq/commit/c74211336e50044d451b48fb4e1143c8cb5a14d1))


### Bug Fixes

* **history:** keep pack requests and show them for button requests ([a651e9a](https://github.com/Daemeron/dolq/commit/a651e9ad00116db8588dd74b91da7a85b02b3771))

## [0.3.3](https://github.com/Daemeron/dolq/compare/dolq-v0.3.2...dolq-v0.3.3) (2026-10-17)


### Bug Fixes

* **history:** keep download results across restarts ([a5fa099](https://github.com/Daemeron/dolq/commit/a5fa099bc1c356b5988d1dafcc19bd0652da9fd5))

## [0.3.2](https://github.com/Daemeron/dolq/compare/dolq-v0.3.1...dolq-v0.3.2) (2026-10-17)


### Bug Fixes

* **history:** keep the messages you send across restarts ([fb7bb4c](https://github.com/Daemeron/dolq/commit/fb7bb4cab14cd1e0656c925be8aa8cdcc511b805))

## [0.3.1](https://github.com/Daemeron/dolq/compare/dolq-v0.3.0...dolq-v0.3.1) (2026-10-17)


### Bug Fixes

* show channels from previous sessions as not joined ([893557d](https://github.com/Daemeron/dolq/commit/893557de013bb571fd3b1798aa4edd0e1373a042))

## [0.3.0](https://github.com/Daemeron/dolq/compare/dolq-v0.2.0...dolq-v0.3.0) (2026-10-15)


### Features

* **xdcc:** auto-accept downloads, globally or from trusted senders ([2c30b12](https://github.com/Daemeron/dolq/commit/2c30b12e3dc151d76a02def92b3b2c4e56e01439))

## [0.2.0](https://github.com/Daemeron/dolq/compare/dolq-v0.1.4...dolq-v0.2.0) (2026-10-14)


### Features

* add Kubernetes manifests for running dolqd on a NAS ([9ec858c](https://github.com/Daemeron/dolq/commit/9ec858c0f03fc5afb5e29d734fe4e056fc417226))
* authenticate and encrypt the backend socket ([d8f1b7a](https://github.com/Daemeron/dolq/commit/d8f1b7a91da279cfbcb6c3076c55397ee2a6edeb))
* keep plain clients working alongside TLS ([27ac558](https://github.com/Daemeron/dolq/commit/27ac55876eb1258e9c7c7764cc45a73e7d1dcc1c))
* let users run the backend unprotected on purpose ([5ad393d](https://github.com/Daemeron/dolq/commit/5ad393da3a61cd04f981e05304832b5f899de444))
* make TLS and the access token independent switches ([f1df1d7](https://github.com/Daemeron/dolq/commit/f1df1d76cc3f009883054115c9d37fbee5336a1e))
* remember server and SASL passwords in the OS keychain ([e549698](https://github.com/Daemeron/dolq/commit/e54969853ca6d91a507d744297c83148f0dee196))


### Bug Fixes

* **dcc:** never drop an OnClose callback registered during close ([c5c33e6](https://github.com/Daemeron/dolq/commit/c5c33e6a04cb4f5895a3f367dcce331079aa1e17))
* **dolqd:** keep remote clients from choosing where downloads are written ([84d0ebd](https://github.com/Daemeron/dolq/commit/84d0ebd1e2bd138581f023386dbcbf6a41178f8a))
* **dolqd:** log the pairing link only when the token is new or asked for ([1d22040](https://github.com/Daemeron/dolq/commit/1d2204098429dc660def7ff929d0b85e2a7ea36e))
* **dolqd:** make the config dir and history database owner-only ([9b9f5f6](https://github.com/Daemeron/dolq/commit/9b9f5f6182bc0f7759b5b2725ea9e45c18cf0132))
* **dolqd:** use the ACME domain as the pairing link host ([4083f22](https://github.com/Daemeron/dolq/commit/4083f2296c4fa6c6aa46128171879caee2442686))
* forget the saved backend token when the remote address changes ([a5a5d75](https://github.com/Daemeron/dolq/commit/a5a5d754b6aa9251197687bfc453e38b9a320569))
* hold CA-valid certificates to an existing pin ([619e486](https://github.com/Daemeron/dolq/commit/619e486f00e6280dbf25e92c45a64dd42309d001))
* **ipcproto:** bound the TLS handshake with the sniff timeout ([5761fdc](https://github.com/Daemeron/dolq/commit/5761fdca07b0d49c337e9dd5dc341ec0ad6fd677))
* **ipcproto:** only replace a socket at -socket and bind it owner-only ([6255636](https://github.com/Daemeron/dolq/commit/6255636eb6f71d9ec2c107af5c640f6a651d40f4))
* keep remote backends saved before TLS existed talking plain ([56f0bfe](https://github.com/Daemeron/dolq/commit/56f0bfe130852408af864d22ca2e071d6ca676cc))
* keep the main window on the app's own page ([cfe80e1](https://github.com/Daemeron/dolq/commit/cfe80e1a5ea999e0e73c7910e3a36712dc9ba066))
* memoise fetchHistoryPage so the history effects stop re-running ([4ac4324](https://github.com/Daemeron/dolq/commit/4ac432495fd124f57cedda5722906d167d480288))
* move @playwright/test to devDependencies ([1b6cb8c](https://github.com/Daemeron/dolq/commit/1b6cb8c98d03c7f6d85910f4f29885e58e971808))
* reject pairing links with a malformed fingerprint ([74315fd](https://github.com/Daemeron/dolq/commit/74315fd577dd753be43c0384fdc8c90bf1ad5ca3))
* resolve biome a11y and hook-dependency lint warnings ([224f925](https://github.com/Daemeron/dolq/commit/224f925131b31633c63ab0da4c436773f4817763))
* restrict secrets.json even when an old temp file exists ([591b40e](https://github.com/Daemeron/dolq/commit/591b40e1ffcc02d4091027e1bf9d0a6ebb0ae28f))
* send the server password and scope per-nick updates to one server ([584aa6c](https://github.com/Daemeron/dolq/commit/584aa6cf853b4bf6629c166eabb8d6a3ddcd9ff3))
* show channel events in their channels and hide them from the Log ([a7d2cd0](https://github.com/Daemeron/dolq/commit/a7d2cd0206cc35502249a3d9e866a3ca8279c422))
* start a new remote backend setup with TLS ticked ([2e9abf8](https://github.com/Daemeron/dolq/commit/2e9abf86a0414ae1bb227744ca6b9d920f4dfd27))

## [0.1.4](https://github.com/Daemeron/dolq/compare/dolq-v0.1.3...dolq-v0.1.4) (2026-10-13)


### Bug Fixes

* make the tray opt-in and ship its icon in packaged builds ([5452d3f](https://github.com/Daemeron/dolq/commit/5452d3f45a806f5d409f2b579a5419bee2ebde9f))

## [0.1.3](https://github.com/Daemeron/dolq/compare/dolq-v0.1.2...dolq-v0.1.3) (2026-10-13)


### Bug Fixes

* guard the remaining unhandled IPC calls ([c853dd6](https://github.com/Daemeron/dolq/commit/c853dd67756e82665d3a97af89344f99ddc468ae))

## [0.1.2](https://github.com/Daemeron/dolq/compare/dolq-v0.1.1...dolq-v0.1.2) (2026-10-12)


### Bug Fixes

* fix connection bug ([1619bfc](https://github.com/Daemeron/dolq/commit/1619bfc3bf785c3ee3834305ea1572acafbbdc08))
* handle backend IPC failures in the renderer ([c7f98fc](https://github.com/Daemeron/dolq/commit/c7f98fc2f92a75d2c87c505c1da40bf714564836))
* use a named pipe for the backend IPC on Windows ([02d0b5c](https://github.com/Daemeron/dolq/commit/02d0b5c76b36bac3f85ce3c54a4e594b944fd39c))

## [0.1.1](https://github.com/Daemeron/dolq/compare/dolq-v0.1.0...dolq-v0.1.1) (2026-09-28)


### Bug Fixes

* force LF line endings for Go source regardless of OS, via .gitattributes. ([52427bc](https://github.com/Daemeron/dolq/commit/52427bc3df8abf8b22da701d40883c63de5a82e4))

## 0.1.0 (2026-09-27)


### Features

* accessibility pass - modal focus management and icon-button labels ([80e6d25](https://github.com/Daemeron/dolq/commit/80e6d253ba3dfa22ec38a963b1208c8f0ad036ae))
* add a server select modal and a list of selected public servers ([ae0298c](https://github.com/Daemeron/dolq/commit/ae0298ce8e7c3ed0e16d81035199eb141399bebd))
* add auto connect ([7bca400](https://github.com/Daemeron/dolq/commit/7bca400ca0f64891118f510b6026ef8b00970537))
* add away status ([ac74eff](https://github.com/Daemeron/dolq/commit/ac74eff30a5fa5590bbd286010b5be7a1e46a25f))
* add CAP negotiation (CAP LS/CAP REQ) ([56886bf](https://github.com/Daemeron/dolq/commit/56886bfcd2e46d00544743cad51423be977696f4))
* add clickable links ([cfe3ac8](https://github.com/Daemeron/dolq/commit/cfe3ac845fbbcd80969c5fcae537fe1655385d39))
* add CTCP support ([04f55f9](https://github.com/Daemeron/dolq/commit/04f55f9dd6a4f753294920ca0ea69c6f1ba9321e))
* add DCC CHAT ([c881cfa](https://github.com/Daemeron/dolq/commit/c881cfa5e63ec1295658963bea913aba19c8ba6a))
* add dolq icons ([093ed6b](https://github.com/Daemeron/dolq/commit/093ed6b18325b5f543a5f36703895559d6ba5fa5))
* add flooding protection ([090743e](https://github.com/Daemeron/dolq/commit/090743e045d29210803eb6e6174f699e84b909b9))
* add history search ([9e6f978](https://github.com/Daemeron/dolq/commit/9e6f978afc6cacd8192821eb87733b0fc6722664))
* add ignore/block list ([87e39c4](https://github.com/Daemeron/dolq/commit/87e39c49ba2ebe5a2023f78c2ff549ca9c159f74))
* add log export ([92403cb](https://github.com/Daemeron/dolq/commit/92403cb7a853b3adfd208302e9c72dcb02613ace))
* add mention notifications ([9381b21](https://github.com/Daemeron/dolq/commit/9381b21d34b75fb544fa9bb0805a9add6bc3115f))
* add multiple identities per network ([aa37ef6](https://github.com/Daemeron/dolq/commit/aa37ef64a7a9f1f57ea4fb6918b2a80f4f1874fb))
* add nick collision handling ([1df2204](https://github.com/Daemeron/dolq/commit/1df22041cec118e49a801cb6e8a23c38b659409b))
* add nickserv identify helper ([10ccb67](https://github.com/Daemeron/dolq/commit/10ccb6798edbe5208260e3ce183bcc3f3a58e9fa))
* add notice support ([fce2f2d](https://github.com/Daemeron/dolq/commit/fce2f2db838591b70070ece94ee6d161c4abfb30))
* add per-server identity defaults ([d27aa86](https://github.com/Daemeron/dolq/commit/d27aa864d2084eac1ccf0227f25e482aec7cafd1))
* add preference window ([f0e6526](https://github.com/Daemeron/dolq/commit/f0e65267991cabf4e2d2a6cd87ab8da137574f9d))
* add preferences to the macos app menu ([93c0539](https://github.com/Daemeron/dolq/commit/93c0539229f2410517bde5c3c5da7086a6e7f87a))
* add private message support ([42a77d8](https://github.com/Daemeron/dolq/commit/42a77d801f13e169cc9eaf56132ca07dc3c1da8b))
* add SASL ([7164759](https://github.com/Daemeron/dolq/commit/7164759f330a3d9e0fcf1f189e2d78d173781954))
* add scripting/aliases ([5ecfc3f](https://github.com/Daemeron/dolq/commit/5ecfc3f8921940bd61b3f46e4ea016d562b91257))
* add server connection status indicator as well as connect/disconnect actions ([375d0fb](https://github.com/Daemeron/dolq/commit/375d0fb9e6ce26cd9908115e83466e07313ca1de))
* add standalone backend dev scripts with a watch mode ([9d8ce7c](https://github.com/Daemeron/dolq/commit/9d8ce7c1aed87fe97247f19e3e17fb6a88ec38df))
* add support for multiple simultaneous irc server connections ([8b0249d](https://github.com/Daemeron/dolq/commit/8b0249dcea29ba48ead9eca2eff882454518e54c))
* add timestamp format and message density preferences ([892b354](https://github.com/Daemeron/dolq/commit/892b354c2fd8b77e8436214cb3a2d38370161d7a))
* add TLS support ([db4b7dc](https://github.com/Daemeron/dolq/commit/db4b7dc95949b3a07e9fd8e1580243501adf7986))
* add topic parsing ([25385bc](https://github.com/Daemeron/dolq/commit/25385bc05e916ae8a1d86dd57fe89dc0c4bb2ef3))
* add ui improvements ([fe2a5df](https://github.com/Daemeron/dolq/commit/fe2a5df214f8711c4f9cb68867dbb02c78ab1751))
* add unread indicator to channels ([f804a1b](https://github.com/Daemeron/dolq/commit/f804a1bf5dfae82970656793b6582e7889ca86eb))
* add user channel privileges ([6d8d8a6](https://github.com/Daemeron/dolq/commit/6d8d8a6cf449995e6d7c7eebb4678a27f8d94cfa))
* add virtual lists ([83e9353](https://github.com/Daemeron/dolq/commit/83e9353d186f0b8b76eb6ca27196cf331d73460b))
* add WHOIS panel ([ef81ab8](https://github.com/Daemeron/dolq/commit/ef81ab8d4155020c554bc476cfac2cfc5d75b0c4))
* add zustand store with persistence ([60f359c](https://github.com/Daemeron/dolq/commit/60f359c3615cc7175f43d0bc45fc86ea6df7fa87))
* basic data persistance with sqlite ([ab1c93d](https://github.com/Daemeron/dolq/commit/ab1c93de33b17125cd9535ca9f2f93c116f5f468))
* color the channel prefix and move the connection status button above the user list ([d64683d](https://github.com/Daemeron/dolq/commit/d64683d385cebeda09dbc3d78d0ff57decd88c78))
* configurable download directory and port range ([cb236c0](https://github.com/Daemeron/dolq/commit/cb236c0c6b3a69c281ab51e91cb35669db3ead70))
* desktop notifications with per-channel mute ([11a15c7](https://github.com/Daemeron/dolq/commit/11a15c73c6758ac414d727f76d49b16d7c1bd63e))
* disconnect from the server and leave all joined channels on app close ([86898f3](https://github.com/Daemeron/dolq/commit/86898f31beebcde82cb3b28f869bb87df2632da5))
* echo back locally channel messages ([53542aa](https://github.com/Daemeron/dolq/commit/53542aa8d7112849a15a52877cddbdf2d38ff4bc))
* emoji picker, closing out Milestone 4 ([883a2b2](https://github.com/Daemeron/dolq/commit/883a2b2a229c01d3c35dbbe2a6b026d7f1766272))
* error boundary + edit server identity after adding it ([1c32f04](https://github.com/Daemeron/dolq/commit/1c32f04b70efb8f9920e85032136771456e5253f))
* fill in the extended 16-98 mIRC color palette ([4730acf](https://github.com/Daemeron/dolq/commit/4730acf7f5bfda5442ea3df6eeae4f9f3a1b4ce0))
* hand-rolled IRC formatting/color parser, drop irc-caret-notation ([63a4da6](https://github.com/Daemeron/dolq/commit/63a4da660833379bdde5e8a25515cae9a147039d))
* irc:// and ircs:// link handling ([c94748c](https://github.com/Daemeron/dolq/commit/c94748c3f45f08e1679975a2d4b36f921be0503e))
* light theme ([3585449](https://github.com/Daemeron/dolq/commit/35854498dc103a24f7c7d63c3125270b29890b52))
* make the tray icon toggleable from preferences ([c80b3df](https://github.com/Daemeron/dolq/commit/c80b3df4c708499241e40194263bde6be8335f40))
* pack-list browsing quality-of-life via search ([2696d64](https://github.com/Daemeron/dolq/commit/2696d64ffb3662390a37f6bae3a1c29633ff9afa))
* preferences - font size and font family ([73a871e](https://github.com/Daemeron/dolq/commit/73a871e72c335b5ce6f04b9d9450fa4b06ac569b))
* preferences - keybinding customization ([931709e](https://github.com/Daemeron/dolq/commit/931709ef596bcdc5e960cd5049cd5dfdd80f673b))
* preferences - per-server color overrides ([d1538cd](https://github.com/Daemeron/dolq/commit/d1538cdcb63ffc81b52bccb0db5a741778af57ce))
* preferences - sound alerts ([fa17c4e](https://github.com/Daemeron/dolq/commit/fa17c4e0b50f2d1b875d06de48122eb69298f9aa))
* Preferences/Add-Edit Server as full views, not popups ([a692eaa](https://github.com/Daemeron/dolq/commit/a692eaa398b66dbda88e44da99373f0923231690))
* preserve joined status in channels ([ccbca5f](https://github.com/Daemeron/dolq/commit/ccbca5f9a714cf4aec2436cdab2d5da502e23b22))
* remote backend mode + Docker deployment for dolqd ([d3200f8](https://github.com/Daemeron/dolq/commit/d3200f8fd5d86a2264513f87a4dd31af60859487))
* rename client to Dolq and the color scheme ([26a402f](https://github.com/Daemeron/dolq/commit/26a402f32aef58939e4fa3230edc1d5d5c8172df))
* resume partial downloads via CTCP DCC RESUME/ACCEPT ([46bc5ec](https://github.com/Daemeron/dolq/commit/46bc5ec44f3217e3dcfc4ae79edd8bad88a1cb35))
* **server:** add basic irc client ([ec5f42c](https://github.com/Daemeron/dolq/commit/ec5f42c31b4feab4067800983187aa956f607e8f))
* **server:** draft a relay to be server to client middle-man ([d2a748c](https://github.com/Daemeron/dolq/commit/d2a748c5d4c41bc789861c4ec823d5bdee53664b))
* system tray icon with minimize-to-tray and unread badge ([6113da0](https://github.com/Daemeron/dolq/commit/6113da0d955d72cada6cf0b2679055f744457a5d))
* transfer manager UI - queue, progress, speed, pause/resume ([105f3e0](https://github.com/Daemeron/dolq/commit/105f3e093bd0bbf917269792027d12b7b80f33ed))
* use a native macos template image for the tray icon ([7f3cfa3](https://github.com/Daemeron/dolq/commit/7f3cfa368b19d911233dc7bd7021497ab716a98c))
* wire persistence with frontend ([42da27e](https://github.com/Daemeron/dolq/commit/42da27e82d996e5695e041cd37ae088a20b8bb95))
* XDCC GET / DCC SEND, with passive and active mode ([ff7bc38](https://github.com/Daemeron/dolq/commit/ff7bc38ad343b59a2b717543d21268e6ee60dd75))
* XDCC LIST request + parse pack listings ([94332ee](https://github.com/Daemeron/dolq/commit/94332ee7b7e808db5815c379f6eeb72d63dc5dc3))


### Bug Fixes

* a second client never got live fan-out from a shared session ([ffc1f57](https://github.com/Daemeron/dolq/commit/ffc1f57642ee7cd5d70366b1db61446089918c10))
* add PING timeouts handling ([65771f8](https://github.com/Daemeron/dolq/commit/65771f8580a6dbb51ec2cfc06de0f27efbb09137))
* auto-reconnect servers on app restart ([40f0c12](https://github.com/Daemeron/dolq/commit/40f0c12816fb1af7998a5e0307fca6d60d21fdb4))
* channel join/leave bugs and log disconnects ([ea34955](https://github.com/Daemeron/dolq/commit/ea34955f302684c023b27876bfa392a052c75d71))
* connect reconciliation process with store hydration ([5423b45](https://github.com/Daemeron/dolq/commit/5423b45ed1fe087abc1235392e0b450a37ff5cc0))
* don't default the connect form to a silently-dialable localhost ([3b573b5](https://github.com/Daemeron/dolq/commit/3b573b568df04e28e6631f53d933382f2feb05e5))
* fix electron builder attempting to publish when our workflow does it later on ([5bacb8a](https://github.com/Daemeron/dolq/commit/5bacb8a7da30ed3a9df2a8838401e72f253c3a26))
* fix incomplete test wait ([71fe87c](https://github.com/Daemeron/dolq/commit/71fe87c3ee4a7c771726df745fa8f847829bfb5b))
* fix macos build binaries job pulling self-signed cert meant only for windows ([043dace](https://github.com/Daemeron/dolq/commit/043dacefe9fd1ca198f17ab45ec8017814d1b3b1))
* fix release workflow chain ([7c13b04](https://github.com/Daemeron/dolq/commit/7c13b044d6d65490049df259349f8c2f2932bf21))
* fix workflows using outdated data and add author for binary builds ([d63192e](https://github.com/Daemeron/dolq/commit/d63192e248f573bda1b0af6ca5dcffeaa3966ef4))
* handle IPv6 address literals ([6e7b0d5](https://github.com/Daemeron/dolq/commit/6e7b0d5aa043a8d267906f5285108f2727c00d1f))
* **main:** react dev tools not loading ([4ebc8d1](https://github.com/Daemeron/dolq/commit/4ebc8d1fc14c7181507b914a884690bcff282344))
* nil privileges slice crashing the app on channel join ([faefc76](https://github.com/Daemeron/dolq/commit/faefc76bd1081c939baca1d12b10cf94b47bc104))
* parse privilege changes mixed with other modes ([bf0dcb3](https://github.com/Daemeron/dolq/commit/bf0dcb3bea36968fb12baa5d35ab49cc51c400de))
* remember scroll position between servers and channels ([c4bd711](https://github.com/Daemeron/dolq/commit/c4bd7117bb70da1487c6567ef5c01bf80728d193))
* **renderer:** clean up styles and remove for now not needed code ([cdd31d2](https://github.com/Daemeron/dolq/commit/cdd31d2d4aa1400448d84eaab6d373e0f007d2ab))
* route topic/WHOIS/XDCC-pack text through IrcText too ([5426174](https://github.com/Daemeron/dolq/commit/542617452131d6aeff07dc7010a23d282f560fd0))
* scope messageMap/userMap keys per-server, not just per-channel ([d7bb339](https://github.com/Daemeron/dolq/commit/d7bb3390214405fec810032664ecc4bab561a817))
* stale form data on server switch, dead-socket hang/crash risk ([5f4f769](https://github.com/Daemeron/dolq/commit/5f4f76994b8aa5c6f0b97fb22d9527ed85232129))

## Changelog
