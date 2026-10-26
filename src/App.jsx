// ==========================================
// 2. MAIN APP COMPONENT
// ==========================================
import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

const DEVICE_OPTIONS = [
  { id: 'WM-001', label: 'WM-001 (Blok A)' },
  { id: 'WM-002', label: 'WM-002 (Blok B)' },
  { id: 'WM-003', label: 'WM-003 (Komersial)' },
];

export default function App() {
  // Navigation & Role State
  const [activeRole, setActiveRole] = useState('customer');
  const [activeTab, setActiveTab] = useState('dashboard');
  const userEmail = 'rama@gmail.com';
  const userName = 'Rama Danu';

  // Selected Device ID
  const [selectedDeviceId, setSelectedDeviceId] = useState('WM-001');

  // Realtime Device State
  const [deviceState, setDeviceState] = useState({
    device_id: 'WM-001',
    sisa_liter: 0,
    debit_realtime: 0,
    status_katup: false,
    status_alat: false,
    last_ping: null,
  });

  // Flow rate history for chart rendering
  const [chartData, setChartData] = useState([]);

  // Transaction History State
  const [transactions, setTransactions] = useState([]);

  // System Logs for Officer View
  const [systemLogs, setSystemLogs] = useState([]);

  // ==========================================
  // 3. REALTIME SIMULATION & SUPABASE SYNC
  // ==========================================
  useEffect(() => {
    if (!supabase) return undefined;

    let isActive = true;
    const fetchDeviceData = async () => {
      const { data, error } = await supabase
        .from('devices')
        .select('*')
        .eq('device_id', selectedDeviceId)
        .maybeSingle();

      if (!isActive) return;
      if (error) {
        console.error('Gagal mengambil data perangkat:', error);
        return;
      }
      if (data) {
        setDeviceState(data);
        setChartData((previous) => [
          ...previous.slice(-19),
          {
            time: new Date().toLocaleTimeString('id-ID'),
            flow: Number(data.debit_realtime) || 0,
          },
        ]);
      }
    };

    fetchDeviceData();
    const channel = supabase
      .channel(`device-changes-${selectedDeviceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, (payload) => {
        if (payload.new?.device_id === selectedDeviceId) {
          setDeviceState(payload.new);
          setChartData((previous) => [
            ...previous.slice(-19),
            {
              time: new Date().toLocaleTimeString('id-ID'),
              flow: Number(payload.new.debit_realtime) || 0,
            },
          ]);
        }
      })
      .subscribe();

    return () => {
      isActive = false;
      supabase.removeChannel(channel);
    };
  }, [selectedDeviceId]);

  // Handle Token Topup logic
  const handleTopupToken = async (
    nominal,
    metode,
    recipientEmail = userEmail,
    targetDeviceId = selectedDeviceId
  ) => {
    const HARGA_PER_M3 = 5000;
    const literDiperoleh = (nominal / HARGA_PER_M3) * 1000;
    const m3Diperoleh = (nominal / HARGA_PER_M3).toFixed(3);
    let newSisaLiter;

    if (supabase) {
      const { data: updatedQuota, error: quotaError } = await supabase.rpc('add_device_quota', {
        p_device_id: targetDeviceId,
        p_liter: literDiperoleh
      });

      if (quotaError) throw quotaError;
      newSisaLiter = Number(updatedQuota);
      if (!Number.isFinite(newSisaLiter)) {
        throw new Error(`Supabase tidak mengembalikan saldo kuota ${targetDeviceId} yang valid.`);
      }

      const { error: transactionError } = await supabase.from('transactions').insert([
        {
          user_email: recipientEmail,
          device_id: targetDeviceId,
          nominal: parseInt(nominal, 10),
          liter_diperoleh: literDiperoleh,
          metode_pembayaran: metode
        }
      ]);

      if (transactionError) {
        throw new Error(
          `Kuota ${targetDeviceId} sudah ditambahkan, tetapi transaksi gagal dicatat: ${transactionError.message}`
        );
      }
    } else {
      newSisaLiter = (Number(deviceState.sisa_liter) || 0) + literDiperoleh;
    }

    const newTx = {
      id: Date.now(),
      waktu: new Date().toLocaleString('id-ID'),
      device_id: targetDeviceId,
      metode: metode,
      nominal: parseInt(nominal, 10),
      liter: literDiperoleh,
      m3: m3Diperoleh,
      user: recipientEmail
    };

    if (targetDeviceId === selectedDeviceId) {
      setDeviceState((prev) => ({ ...prev, sisa_liter: newSisaLiter }));
    }

    setTransactions((prev) => [newTx, ...prev]);

    setSystemLogs((prev) => [
      {
        id: Date.now(),
        time: new Date().toLocaleTimeString('id-ID'),
        level: 'SUCCESS',
        msg: `Injeksi Token ${targetDeviceId}: +${literDiperoleh} Liter (${metode}) oleh ${recipientEmail}`
      },
      ...prev
    ]);
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans flex flex-col items-center w-full">
      {/* ================= HEADER BAR ================= */}
      <header className="w-full bg-white border-b border-slate-200 shadow-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Logo & Brand */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center text-white font-bold shadow-md">
              💧
            </div>
            <span className="text-xl font-bold text-slate-800 tracking-tight">Smart Water Meter</span>
          </div>

          {/* User Badge & Role Switcher */}
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-slate-100 rounded-lg p-1 border border-slate-200">
              <button
                onClick={() => {
                  setActiveRole('customer');
                  setActiveTab('dashboard');
                }}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition ${
                  activeRole === 'customer'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Mode Customer
              </button>
              <button
                onClick={() => {
                  setActiveRole('officer');
                  setActiveTab('hardware-test');
                }}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition ${
                  activeRole === 'officer'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Mode Petugas WTP
              </button>
            </div>

            <div className="text-right hidden sm:block">
              <span className="text-xs text-slate-500 block">
                {activeRole === 'customer' ? 'Customer Profile' : 'WTP Officer Admin'}
              </span>
              <span className="text-sm font-semibold text-slate-700">
                {activeRole === 'customer' ? `${userName} (customer)` : 'Petugas WTP Admin'}
              </span>
            </div>

            <button
              onClick={() => alert('Logout berhasil')}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 transition"
            >
              Keluar
            </button>
          </div>
        </div>
      </header>

      {/* ================= MAIN CONTENT WRAPPER ================= */}
      <main className="w-full max-w-5xl px-4 py-8 flex-1">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 mb-6 border-b border-slate-200 pb-2">
          {activeRole === 'customer' ? (
            <>
              <TabButton
                label="Dashboard"
                active={activeTab === 'dashboard'}
                onClick={() => setActiveTab('dashboard')}
              />
              <TabButton
                label="Beli Token"
                active={activeTab === 'buy'}
                onClick={() => setActiveTab('buy')}
              />
              <TabButton
                label="Riwayat"
                active={activeTab === 'history'}
                onClick={() => setActiveTab('history')}
              />
            </>
          ) : (
            <>
              <TabButton
                label="Kontrol WTP & IoT"
                active={activeTab === 'wtp-control'}
                onClick={() => setActiveTab('wtp-control')}
              />
              <TabButton
                label="Tes Koneksi"
                active={activeTab === 'hardware-test'}
                onClick={() => setActiveTab('hardware-test')}
              />
              <TabButton
                label="Injeksi Token Loket"
                active={activeTab === 'buy'}
                onClick={() => setActiveTab('buy')}
              />
              <TabButton
                label="Log Transaksi & System"
                active={activeTab === 'history'}
                onClick={() => setActiveTab('history')}
              />
            </>
          )}
        </div>

        {/* Tab Views Render */}
        {activeTab === 'dashboard' && (
          <DashboardView
            device={deviceState}
            chartData={chartData}
            onTopupClick={() => setActiveTab('buy')}
          />
        )}

        {activeTab === 'buy' && (
          <BeliTokenView
            userEmail={activeRole === 'customer' ? userEmail : 'loket-wtp@petugas.id'}
            isOfficer={activeRole === 'officer'}
            deviceOptions={DEVICE_OPTIONS}
            selectedDeviceId={selectedDeviceId}
            onDeviceChange={setSelectedDeviceId}
            onSuccess={handleTopupToken}
          />
        )}

        {activeTab === 'history' && (
          <RiwayatView
            transactions={transactions}
            systemLogs={systemLogs}
            isOfficer={activeRole === 'officer'}
          />
        )}

        {activeTab === 'wtp-control' && (
          <WtpOfficerControlView
            device={deviceState}
            selectedDeviceId={selectedDeviceId}
            setSelectedDeviceId={setSelectedDeviceId}
            deviceOptions={DEVICE_OPTIONS}
            onTopupClick={() => setActiveTab('buy')}
          />
        )}

        {activeTab === 'hardware-test' && (
          <HardwareTestView
            device={deviceState}
            deviceId={selectedDeviceId}
            onDeviceChange={setSelectedDeviceId}
            onDeviceUpdate={setDeviceState}
            deviceOptions={DEVICE_OPTIONS}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="w-full text-center py-4 text-xs text-slate-400 border-t border-slate-200 bg-white">
        Smart Water Meter System &copy; 2026 • Connected to Supabase & Netlify
      </footer>
    </div>
  );
}

// ==========================================
// 4. SUB-COMPONENTS & VIEWS
// ==========================================

function TabButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-2 text-sm font-semibold rounded-lg transition-all ${
        active
          ? 'bg-sky-600 text-white shadow-sm'
          : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
      }`}
    >
      {label}
    </button>
  );
}

// ------------------------------------------
// DASHBOARD VIEW (CUSTOMER)
// ------------------------------------------
function DashboardView({ device, chartData, onTopupClick }) {
  const sisaM3 = (device.sisa_liter / 1000).toFixed(3);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Card 1: Sisa Kuota */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
        <div>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Sisa Kuota — {device.device_id}
          </span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-4xl font-extrabold text-slate-900">
              {device.sisa_liter.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </span>
            <span className="text-lg font-bold text-slate-700">Liter</span>
          </div>
          <span className="text-sm font-medium text-slate-400 block mt-0.5">
            {sisaM3} m³
          </span>

          {/* Badges Status */}
          <div className="flex items-center gap-2 mt-6">
            <span
              className={`px-2.5 py-1 text-xs font-bold rounded-md ${
                device.status_katup
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-100 text-rose-800 border border-rose-200'
              }`}
            >
              Katup: {device.status_katup ? 'TERBUKA' : 'TERTUTUP'}
            </span>

            <span
              className={`px-2.5 py-1 text-xs font-bold rounded-md ${
                device.status_alat
                  ? 'bg-slate-200 text-slate-700 border border-slate-300'
                  : 'bg-amber-100 text-amber-800 border border-amber-200'
              }`}
            >
              Alat: {device.status_alat ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>

        {/* Status Warning / Action */}
        <div className="mt-8 pt-4 border-t border-slate-100">
          {device.sisa_liter <= 0 ? (
            <div>
              <p className="text-xs font-semibold text-rose-600 mb-2">
                Kuota habis. Silakan beli token.
              </p>
              <button
                onClick={onTopupClick}
                className="w-full py-2 bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs rounded-md shadow transition"
              >
                Beli Token Sekarang
              </button>
            </div>
          ) : (
            <p className="text-xs font-medium text-slate-500">
              Status normal. Katup air siap mengalirkan air WTP.
            </p>
          )}
        </div>
      </div>

      {/* Card 2: Grafik Debit Air Realtime */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Debit Air Realtime (L/menit)
            </span>
            <span className="text-xs font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded border border-sky-100">
              {device.debit_realtime} L/m
            </span>
          </div>

          {/* Simple SVG Chart */}
          <div className="h-44 w-full overflow-hidden rounded-lg border border-slate-100 bg-slate-50 p-2">
            <div className="flex h-full min-w-0 flex-col">
              <div className="flex min-h-0 flex-1 items-end justify-between gap-1 overflow-hidden">
                {chartData.map((d, i) => {
                  const heightPercent = Math.min(100, (d.flow / 5) * 100);
                  return (
                    <div key={`${d.time}-${i}`} className="flex h-full min-w-0 flex-1 items-end">
                      <div
                        title={`${d.time}: ${d.flow} L/m`}
                        style={{ height: `${Math.max(5, heightPercent)}%` }}
                        className="mx-auto w-3/4 max-w-6 rounded-t bg-sky-500 transition-colors hover:bg-sky-600"
                      />
                    </div>
                  );
                })}
              </div>
              <div className="relative mt-2 h-3 shrink-0 text-[9px] text-slate-400">
                {chartData.length > 0 && (
                  <>
                    <span className="absolute left-0">{chartData[0].time.substring(0, 5)}</span>
                    {chartData.length > 2 && (
                      <span className="absolute left-1/2 -translate-x-1/2">
                        {chartData[Math.floor((chartData.length - 1) / 2)].time.substring(0, 5)}
                      </span>
                    )}
                    {chartData.length > 1 && (
                      <span className="absolute right-0">{chartData[chartData.length - 1].time.substring(0, 5)}</span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
          <span>Terakhir Ping: {device.last_ping}</span>
          <span className="text-emerald-600 font-medium">● Streaming Active</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------
// BELI TOKEN VIEW (CUSTOMER & OFFICER)
// ------------------------------------------
function BeliTokenView({
  userEmail,
  isOfficer,
  deviceOptions,
  selectedDeviceId,
  onDeviceChange,
  onSuccess
}) {
  const [nominal, setNominal] = useState(20000);
  const [metode, setMetode] = useState('QRIS');
  const [loading, setLoading] = useState(false);

  const HARGA_PER_M3 = 5000;
  const literDiperoleh = (nominal / HARGA_PER_M3) * 1000;
  const m3Diperoleh = (nominal / HARGA_PER_M3).toFixed(3);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (nominal <= 0) return alert('Nominal harus lebih dari 0');

    setLoading(true);
    try {
      await onSuccess(nominal, metode, userEmail, selectedDeviceId);
      alert(
        `Top-up Token Berhasil!\n+${literDiperoleh} Liter (${m3Diperoleh} m³) ditambahkan ke ${selectedDeviceId}. Katup mengikuti pembacaan firmware alat.`
      );
    } catch (error) {
      console.error('Gagal menginjeksi token:', error);
      alert(`Gagal menginjeksi token: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm max-w-2xl mx-auto">
      <h3 className="text-xl font-bold text-slate-800 mb-1">
        {isOfficer ? 'Injeksi Token Air (Loket WTP)' : 'Beli Token Air'}
      </h3>
      <p className="text-xs text-slate-500 mb-6">
        Tarif Air Bersih WTP: <strong className="text-slate-700">Rp 5.000 / m³</strong>
      </p>

      {isOfficer && (
        <div className="mb-5">
          <label
            className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-600"
            htmlFor="injection-device"
          >
            Pelanggan / ID alat
          </label>
          <select
            id="injection-device"
            value={selectedDeviceId}
            onChange={(event) => onDeviceChange(event.target.value)}
            disabled={loading}
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-mono font-semibold text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-500"
          >
            {deviceOptions.map((device) => (
              <option key={device.id} value={device.id}>
                {device.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Pastikan firmware alat memakai ID yang sama. Katup akan terbuka setelah alat membaca kuota
            dari Supabase (sekitar 3 detik).
          </p>
        </div>
      )}

      {/* Preset Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[20000, 50000, 100000, 200000].map((val) => (
          <button
            key={val}
            type="button"
            onClick={() => setNominal(val)}
            className={`py-2.5 px-3 rounded-lg border text-sm font-semibold transition ${
              nominal === val
                ? 'bg-sky-50 border-sky-500 text-sky-700 shadow-sm'
                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            Rp {val.toLocaleString('id-ID')}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Input Nominal */}
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1 uppercase tracking-wide">
            Nominal Pembayaran (Rp)
          </label>
          <input
            type="number"
            value={nominal}
            onChange={(e) => setNominal(Number(e.target.value))}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 font-semibold focus:ring-2 focus:ring-sky-500 focus:border-sky-500 bg-white"
            placeholder="Masukkan nominal"
            required
          />
        </div>

        {/* Dropdown Metode Pembayaran - Crisp Dark Text */}
        <div>
          <label className="block text-xs font-bold text-slate-600 mb-1 uppercase tracking-wide">
            Metode Pembayaran
          </label>
          <select
            value={metode}
            onChange={(e) => setMetode(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-300 text-slate-800 font-semibold focus:ring-2 focus:ring-sky-500 focus:border-sky-500 bg-white"
          >
            <option value="QRIS" className="text-slate-800 bg-white">
              QRIS
            </option>
            <option value="Transfer Bank" className="text-slate-800 bg-white">
              Transfer Bank
            </option>
            <option value="E-Wallet" className="text-slate-800 bg-white">
              E-Wallet
            </option>
            <option value="Tunai (loket)" className="text-slate-800 bg-white">
              Tunai (loket WTP)
            </option>
          </select>
        </div>

        {/* Preview Output */}
        <div className="bg-sky-50 border border-sky-100 p-4 rounded-lg flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600">Anda mendapat kuota:</span>
          <span className="text-base font-extrabold text-sky-700">
            {literDiperoleh.toFixed(1)} L ({m3Diperoleh} m³)
          </span>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-lg shadow-md transition disabled:opacity-50"
        >
          {loading ? 'Memproses Transaksi...' : 'Bayar & Isi Token'}
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------
// RIWAYAT VIEW
// ------------------------------------------
function RiwayatView({ transactions, systemLogs, isOfficer }) {
  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h3 className="text-base font-bold text-slate-800 mb-4">Riwayat Transaksi Token</h3>

        {transactions.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">Belum ada transaksi.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase bg-slate-50">
                  <th className="py-3 px-4 font-semibold">Waktu</th>
                  <th className="py-3 px-4 font-semibold">Perangkat</th>
                  <th className="py-3 px-4 font-semibold">Metode</th>
                  <th className="py-3 px-4 font-semibold">Nominal</th>
                  <th className="py-3 px-4 font-semibold">Liter Diperoleh</th>
                  {isOfficer && <th className="py-3 px-4 font-semibold">Pengguna</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-medium">{tx.waktu}</td>
                    <td className="py-3 px-4 font-mono text-xs">{tx.device_id}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 text-xs font-semibold rounded bg-slate-100 border border-slate-200">
                        {tx.metode}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      Rp {tx.nominal.toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4 font-bold text-sky-600">
                      +{tx.liter} L ({tx.m3} m³)
                    </td>
                    {isOfficer && <td className="py-3 px-4 text-xs text-slate-500">{tx.user}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Officer System Audit Log */}
      {isOfficer && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-base font-bold text-slate-800 mb-3">Audit Log Sistem IoT WTP</h3>
          <div className="bg-slate-900 text-slate-200 font-mono text-xs p-4 rounded-lg h-48 overflow-y-auto space-y-1.5">
            {systemLogs.map((log) => (
              <div key={log.id} className="flex gap-2">
                <span className="text-slate-500">[{log.time}]</span>
                <span
                  className={
                    log.level === 'ALERT'
                      ? 'text-rose-400 font-bold'
                      : log.level === 'WARN'
                      ? 'text-amber-300'
                      : 'text-emerald-400'
                  }
                >
                  [{log.level}]
                </span>
                <span>{log.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------
// PETUGAS WTP OFFICER CONTROL VIEW
// ------------------------------------------
function HardwareTestView({ device, deviceId, onDeviceChange, onDeviceUpdate, deviceOptions }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [checking, setChecking] = useState(true);
  const [checks, setChecks] = useState({
    web: { status: 'checking', message: 'Memeriksa koneksi browser...' },
    supabase: { status: 'checking', message: 'Menunggu pemeriksaan...' },
    hardware: { status: 'checking', message: 'Menunggu heartbeat perangkat...' },
  });
  const [checkedAt, setCheckedAt] = useState(null);
  const [pingTime, setPingTime] = useState(null);

  useEffect(() => {
    let isActive = true;
    let nextCheckTimeout;

    const runChecks = async () => {
      setChecking(true);
      const browserOnline = navigator.onLine;
      const nextChecks = {
        web: browserOnline
          ? { status: 'pass', message: 'Browser memiliki koneksi jaringan.' }
          : { status: 'fail', message: 'Browser sedang offline.' },
        supabase: { status: 'checking', message: 'Menghubungi Supabase...' },
        hardware: { status: 'checking', message: 'Memeriksa heartbeat perangkat...' },
      };

      if (!supabase) {
        nextChecks.supabase = {
          status: 'fail',
          message: 'Konfigurasi Supabase belum tersedia. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY.',
        };
        nextChecks.hardware = {
          status: 'fail',
          message: 'Pemeriksaan hardware membutuhkan koneksi Supabase.',
        };
      } else {
        try {
          const { data, error } = await supabase
            .from('devices')
            .select('*')
            .eq('device_id', deviceId)
            .maybeSingle();

          if (!isActive) return;

          if (error) {
            nextChecks.supabase = {
              status: 'fail',
              message: `Gagal membaca tabel devices: ${error.message}`,
            };
            nextChecks.hardware = {
              status: 'fail',
              message: 'Heartbeat belum dapat diperiksa karena data Supabase tidak bisa dibaca.',
            };
          } else if (!data) {
            nextChecks.supabase = {
              status: 'pass',
              message: 'Supabase bisa dihubungi, tetapi ID perangkat belum terdaftar.',
            };
            nextChecks.hardware = {
              status: 'fail',
              message: `${deviceId} tidak ditemukan di tabel devices.`,
            };
          } else {
            nextChecks.supabase = {
              status: 'pass',
              message: `Supabase dapat dibaca dan perangkat ${deviceId} ditemukan.`,
            };

            const lastPing = data.last_ping ? new Date(data.last_ping) : null;
            const pingAge = lastPing && !Number.isNaN(lastPing.getTime())
              ? Date.now() - lastPing.getTime()
              : Number.POSITIVE_INFINITY;
            const isFresh = pingAge >= -60_000 && pingAge <= 15_000;
            setPingTime(data.last_ping || null);

            if (data.status_alat === false) {
              nextChecks.hardware = {
                status: 'fail',
                message: 'Database melaporkan perangkat offline. Periksa daya, Wi-Fi, dan firmware.',
              };
            } else if (isFresh) {
              nextChecks.hardware = {
                status: 'pass',
                message: `Heartbeat diterima ${Math.max(0, Math.floor(pingAge / 1000))} detik yang lalu.`,
              };
            } else {
              nextChecks.hardware = {
                status: 'stale',
                message: data.last_ping
                  ? `Heartbeat lama atau format waktu tidak valid (${data.last_ping}). Periksa update last_ping dari firmware.`
                  : 'Belum ada heartbeat. Pastikan perangkat mengirim last_ping ke tabel devices.',
              };
            }

            onDeviceUpdate(data);
          }
        } catch (error) {
          if (!isActive) return;
          nextChecks.supabase = {
            status: 'fail',
            message: `Tidak dapat menghubungi Supabase: ${error.message}`,
          };
          nextChecks.hardware = {
            status: 'fail',
            message: 'Heartbeat belum dapat diperiksa sampai koneksi Supabase pulih.',
          };
        }
      }

      if (isActive) {
        setChecks(nextChecks);
        setCheckedAt(new Date());
        setChecking(false);
        nextCheckTimeout = window.setTimeout(runChecks, 5000);
      }
    };

    runChecks();

    return () => {
      isActive = false;
      window.clearTimeout(nextCheckTimeout);
    };
  }, [deviceId, onDeviceUpdate, refreshKey]);

  const checkStyle = {
    pass: {
      badge: 'bg-emerald-100 text-emerald-800',
      label: 'TERHUBUNG',
      dot: 'bg-emerald-500',
    },
    fail: {
      badge: 'bg-rose-100 text-rose-800',
      label: 'GAGAL',
      dot: 'bg-rose-500',
    },
    stale: {
      badge: 'bg-amber-100 text-amber-800',
      label: 'TIDAK ADA HEARTBEAT',
      dot: 'bg-amber-500',
    },
    checking: {
      badge: 'bg-slate-100 text-slate-600',
      label: 'MEMERIKSA',
      dot: 'bg-slate-400 animate-pulse',
    },
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-sky-700">Diagnostik teknisi</p>
          <h2 className="mt-1 text-2xl font-extrabold text-slate-900">Tes Koneksi Perangkat</h2>
          <p className="mt-1 text-sm text-slate-500">
            Tes ini membaca heartbeat dari database; tidak menggerakkan relay atau katup.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-semibold text-slate-600" htmlFor="test-device">
            ID perangkat
          </label>
          <select
            id="test-device"
            value={deviceId}
            onChange={(event) => onDeviceChange(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-800"
          >
            {deviceOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setRefreshKey((key) => key + 1)}
            disabled={checking}
            className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-bold text-white hover:bg-sky-800 disabled:opacity-60"
          >
            {checking ? 'Memeriksa...' : 'Tes ulang'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          ['Web', checks.web],
          ['Supabase', checks.supabase],
          ['Hardware', checks.hardware],
        ].map(([label, check]) => {
          const style = checkStyle[check.status];
          return (
            <article key={label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold text-slate-800">{label}</h3>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${style.badge}`}>
                  {style.label}
                </span>
              </div>
              <div className="mt-5 flex items-start gap-3">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
                <p className="text-sm leading-6 text-slate-600">{check.message}</p>
              </div>
            </article>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-bold text-slate-800">Data terakhir dari perangkat</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Perangkat</dt>
              <dd className="font-mono font-semibold text-slate-800">{deviceId}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Heartbeat</dt>
              <dd className="text-right font-medium text-slate-800">
                {pingTime && !Number.isNaN(new Date(pingTime).getTime())
                  ? new Date(pingTime).toLocaleString('id-ID')
                  : pingTime || 'Belum ada'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Debit terakhir</dt>
              <dd className="font-semibold text-slate-800">{Number(device.debit_realtime) || 0} L/menit</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Katup (dilaporkan)</dt>
              <dd className="font-semibold text-slate-800">
                {device.status_katup ? 'Terbuka' : 'Tertutup'}
              </dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
            Pemeriksaan terakhir: {checkedAt ? checkedAt.toLocaleTimeString('id-ID') : 'Belum dilakukan'}
          </p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h3 className="text-sm font-bold text-amber-900">Catatan firmware saat ini</h3>
          <p className="mt-2 text-sm leading-6 text-amber-900">
            Perangkat mengirim telemetri ke Supabase setiap 3 detik. Halaman ini memastikan data tersebut
            benar-benar baru, bukan status simulasi dari browser. Firmware saat ini tidak menerima perintah
            tes relay/katup dari web.
          </p>
          <p className="mt-3 text-xs leading-5 text-amber-800">
            Jika Supabase terhubung tetapi hardware tidak ada heartbeat, periksa catu daya ESP8266,
            koneksi Wi-Fi, nilai last_ping, dan hak akses UPDATE/SELECT tabel devices.
          </p>
        </div>
      </div>
    </section>
  );
}

function WtpOfficerControlView({
  device,
  selectedDeviceId,
  setSelectedDeviceId,
  deviceOptions,
  onTopupClick,
}) {
  return (
    <div className="space-y-6">
      {/* Top Banner Control Header */}
      <div className="bg-slate-900 text-white p-6 rounded-xl shadow-md flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold text-amber-400 uppercase tracking-widest block mb-1">
            Dashboard Petugas Operator WTP
          </span>
          <h2 className="text-2xl font-black tracking-tight">Manajemen Alat & Katup Air IoT</h2>
          <p className="text-xs text-slate-400 mt-1">
            Pilih perangkat untuk melakukan *remote override* aliran air dan diagnosa jaringan.
          </p>
        </div>

        {/* Device Selector Dropdown */}
        <div className="bg-slate-800 p-3 rounded-lg border border-slate-700 flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-300">Pilih ID Alat:</span>
          <select
            value={selectedDeviceId}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
            className="bg-slate-900 text-white font-mono font-bold text-sm px-3 py-1.5 rounded border border-slate-600 focus:outline-none focus:border-sky-500"
          >
            {deviceOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Control Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Valve telemetry */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              Status Katup
            </h4>
            <div className="flex items-center gap-2 mb-4">
              <span
                className={`w-3 h-3 rounded-full ${
                  device.status_katup ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              ></span>
              <span className="text-lg font-black text-slate-800">
                Katup: {device.status_katup ? 'TERBUKA' : 'TERTUTUP'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-6">
              Status ini dilaporkan oleh ESP8266. Firmware saat ini belum menerima perintah buka/tutup
              dari web, jadi kontrol jarak jauh belum tersedia.
            </p>
          </div>

          <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-800">
            Uji koneksi di tab Tes Koneksi
          </span>
        </div>

        {/* Realtime Telemetry Status */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
              Telemetri Sensor WTP
            </h4>
            <div className="space-y-3">
              <div className="flex justify-between items-center text-sm border-b border-slate-100 pb-2">
                <span className="text-slate-500">Sisa Kuota:</span>
                <span className="font-bold text-sky-700">{device.sisa_liter.toFixed(1)} Liter</span>
              </div>
              <div className="flex justify-between items-center text-sm border-b border-slate-100 pb-2">
                <span className="text-slate-500">Debit Air Saat Ini:</span>
                <span className="font-bold text-slate-800">{device.debit_realtime} L/min</span>
              </div>
              <div className="flex justify-between items-center text-sm border-b border-slate-100 pb-2">
                <span className="text-slate-500">Status Koneksi:</span>
                <span className={`font-bold ${device.status_alat ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {device.status_alat ? 'Online (dilaporkan)' : 'Offline (dilaporkan)'}
                </span>
              </div>
            </div>
          </div>

          <div className="text-right text-[11px] text-slate-400 mt-4">
            Last Telemetry Ping: {device.last_ping}
          </div>
        </div>

        {/* Quick Token Injector for Officer */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              Injeksi Token Manual
            </h4>
            <p className="text-xs text-slate-500 mb-4">
              Lakukan pendaftaran kuota air langsung untuk pelanggan yang membayar tunai di loket fisik WTP.
            </p>
          </div>

          <button
            onClick={onTopupClick}
            className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg shadow transition flex items-center justify-center gap-2"
          >
            <span>💳 Buka Formulir Loket</span>
          </button>
        </div>
      </div>
    </div>
  );
}
