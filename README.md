# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Smart Water Meter setup

### Web app

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL` and the project's **anon/publishable** key in `.env.local`. Never use a service-role key in the browser.
3. Restart the Vite dev server after changing environment variables.
4. In **Mode Petugas WTP → Tes Koneksi**, select the device ID configured in the firmware (default `WM-001`).

The device row must already exist in the Supabase `devices` table. Apply `supabase/migrations/20261023100000_atomic_device_quota.sql` in the Supabase SQL Editor before using top-ups or the updated firmware. The functions use the caller's permissions, so Row Level Security must permit the anon key to `SELECT` the device row for diagnostics and `UPDATE` it for quota changes and telemetry.

### ESP8266 firmware

The flashable sketch is `firmware/smart_water_meter.ino`. Before uploading it:

1. Install the ESP8266 Arduino core, ArduinoJson, and LiquidCrystal_I2C.
2. Set the Wi-Fi SSID/password and Supabase URL/key in the sketch. The key may be a legacy anon JWT or an `sb_publishable_...` key; the sketch sends the correct headers for either. Do not commit real Wi-Fi credentials.
3. Make sure `DEVICE_ID` matches an existing `devices.device_id`.
4. `RELAY_ACTIVE_LOW` is set to `true` for a relay module that turns on when its IN pin is LOW. Confirm this matches the relay module before connecting the valve supply.
5. Open Serial Monitor at 115200 baud. HTTP, Wi-Fi, NTP, and database errors are reported there.

The firmware uses NTP to write `last_ping` as an ISO-8601 UTC timestamp. Quota top-ups and water consumption use the atomic database functions from the migration so periodic firmware telemetry cannot overwrite a recent top-up. Re-upload the firmware after applying the migration. The hardware test reads telemetry only; it does not switch the relay remotely.
