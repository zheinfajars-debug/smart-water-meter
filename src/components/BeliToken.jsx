import React, { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function BeliToken({ userEmail = "Rama Danu (customer)", deviceId = "WM-001" }) {
  const [nominal, setNominal] = useState(20000);
  const [metode, setMetode] = useState('QRIS');
  const [loading, setLoading] = useState(false);

  // Tarif dasar: Rp 5.000 / m3 (1 m3 = 1000 Liter -> Rp 5 = 1 Liter)[cite: 2]
  const HARGA_PER_M3 = 5000;
  const literDiperoleh = (nominal / HARGA_PER_M3) * 1000; //[cite: 2]
  const m3Diperoleh = (nominal / HARGA_PER_M3).toFixed(3);

  const handleProsesBayar = async (e) => {
    e.preventDefault();
    if (nominal <= 0) return alert("Nominal tidak valid!");

    setLoading(true);

    try {
      // 1. Ambil sisa_liter saat ini dari tabel devices
      const { data: deviceData, error: fetchError } = await supabase
        .from('devices')
        .select('sisa_liter')
        .eq('device_id', deviceId)
        .single();

      if (fetchError) throw fetchError;

      const sisaLama = deviceData?.sisa_liter || 0;
      const totalSisaBaru = sisaLama + literDiperoleh;

      // 2. Update sisa_liter di tabel devices
      const { error: updateError } = await supabase
        .from('devices')
        .update({ sisa_liter: totalSisaBaru })
        .eq('device_id', deviceId);

      if (updateError) throw updateError;

      // 3. Catat riwayat ke tabel transactions[cite: 5]
      const { error: txError } = await supabase
        .from('transactions')
        .insert([
          {
            user_email: userEmail,
            device_id: deviceId,
            nominal: parseInt(nominal),
            liter_diperoleh: literDiperoleh,
            metode_pembayaran: metode
          }
        ]);

      if (txError) throw txError;

      alert(`Pembelian Berhasil!\n+${literDiperoleh} Liter (${m3Diperoleh} m³) berhasil ditambahkan ke ${deviceId}`);
    } catch (err) {
      console.error(err);
      alert("Gagal memproses transaksi: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '600px', background: '#fff', borderRadius: '10px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', fontFamily: 'sans-serif' }}>
      <h3 style={{ marginTop: 0, marginBottom: '4px', color: '#333' }}>Beli Token Air</h3>
      <p style={{ color: '#777', fontSize: '14px', marginTop: 0, marginBottom: '20px' }}>Tarif: Rp 5.000 / m³</p> {/*[cite: 2] */}

      {/* Preset Tombol Nominal */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
        {[20000, 50000, 100000, 200000].map((val) => (
          <button
            key={val}
            type="button"
            onClick={() => setNominal(val)}
            style={{
              padding: '10px',
              border: nominal === val ? '1px solid #0088cc' : '1px solid #e0e0e0',
              borderRadius: '6px',
              background: nominal === val ? '#f0f8ff' : '#f9f9f9',
              color: nominal === val ? '#0088cc' : '#333',
              fontWeight: nominal === val ? 'bold' : 'normal',
              cursor: 'pointer'
            }}
          >
            Rp {val.toLocaleString('id-ID')} {/*[cite: 2] */}
          </button>
        ))}
      </div>

      <form onSubmit={handleProsesBayar}>
        {/* Input Nominal */}
        <div style={{ marginBottom: '16px' }}>
          <input
            type="number"
            value={nominal}
            onChange={(e) => setNominal(Number(e.target.value))}
            style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }}
            required
          />
        </div>

        {/* Option Metode Pembayaran */}
        <div style={{ marginBottom: '20px' }}>
          <select
            value={metode}
            onChange={(e) => setMetode(e.target.value)}
            style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid #ccc', boxSizing: 'border-box', background: '#fff' }}
          >
            <option value="QRIS">QRIS</option> {/*[cite: 4] */}
            <option value="Transfer Bank">Transfer Bank</option> {/*[cite: 4] */}
            <option value="E-Wallet">E-Wallet</option> {/*[cite: 4] */}
            <option value="Tunai (loket)">Tunai (loket)</option> {/*[cite: 4] */}
          </select>
        </div>

        {/* Info Hasil Konversi */}
        <p style={{ fontWeight: '600', color: '#444', marginBottom: '20px' }}>
          Anda mendapat: <span style={{ color: '#0088cc', fontWeight: 'bold' }}>{literDiperoleh.toFixed(1)} L ({m3Diperoleh} m³)</span> {/*[cite: 2] */}
        </p>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '14px',
            background: '#0088cc',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 'bold',
            fontSize: '15px'
          }}
        >
          {loading ? 'Memproses...' : 'Bayar & Isi Token'} {/*[cite: 2] */}
        </button>
      </form>
    </div>
  );
}