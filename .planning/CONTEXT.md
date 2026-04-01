# CONTEXT

- The repo now contains two parallel models:
  - legacy live runtime path: known peer -> `hello` -> `server-info` -> punch
  - new pure traversal path: advert -> discover -> offer / answer -> punch plan
- The new traversal path is implemented and tested in pure modules, but it is not yet the default live runtime path.
- Live relay validation is currently weaker than STUN validation:
  - STUN against `fips.tomdwyer.uk` was confirmed
  - relay publish succeeds, but DM receipt/server roundtrip still needs stronger proof
- The intended downstream consumer is `ops-dashboard`, where a server should advertise availability continuously and clients should attach from desktop or mobile via discovery.
- Editing `ops-dashboard` requires approval because it sits outside the current writable roots.
