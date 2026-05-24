import express from 'express';
import sqlite3 from 'sqlite3';
import cors from 'cors';
import bodyParser from 'body-parser';
import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file if it exists
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    envFile.split('\n').forEach(line => {
        const parts = line.split('=');
        if (parts.length >= 2) {
            const key = parts[0].trim();
            const val = parts.slice(1).join('=').trim().replace(/(^['"]|['"]$)/g, '');
            if (key) process.env[key] = val;
        }
    });
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

// Database Setup
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'ambulance.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Database connection error:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        db.run(`CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT NOT NULL,
            service TEXT,
            message TEXT,
            status TEXT DEFAULT 'Pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, () => {
            // Safe column migration
            db.run(`ALTER TABLE bookings ADD COLUMN operator_message TEXT`, () => {});
            db.run(`ALTER TABLE bookings ADD COLUMN email TEXT`, () => {});
        });
        db.run(`CREATE TABLE IF NOT EXISTS booking_routes (
            booking_id INTEGER PRIMARY KEY,
            route_json TEXT,
            distance REAL,
            duration REAL,
            is_busy INTEGER DEFAULT 0
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS driver_locations (
            booking_id INTEGER PRIMARY KEY,
            lat REAL,
            lng REAL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    }
});

// API Endpoints
// Real & Simulated SMS Service
const sendTwilioSMS = async (phone, body) => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    
    if (!accountSid || !authToken || !fromNumber) return false;
    
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const headers = {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
    };
    const params = new URLSearchParams({
        From: fromNumber,
        To: phone,
        Body: body
    });
    
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: params.toString()
        });
        return res.ok;
    } catch(e) {
        console.error("Twilio SMS failed:", e);
        return false;
    }
};

const sendFast2SMSSMS = async (phone, message) => {
    const apiKey = process.env.FAST2SMS_API_KEY;
    if (!apiKey) return false;
    
    // Clean to 10 digits for Indian number compatibility
    let cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
        cleanPhone = cleanPhone.substring(2);
    }
    
    const url = 'https://www.fast2sms.com/dev/bulkV2';
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'authorization': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                route: 'q',
                message: message,
                language: 'english',
                numbers: cleanPhone
            })
        });
        const data = await res.json();
        console.log("Fast2SMS API Response:", data);
        return data.return === true;
    } catch(e) {
        console.error("Fast2SMS failed:", e);
        return false;
    }
};

const sendSMS = async (phone, name, service, id) => {
    // Attempt to detect host network IP for real phone access
    let host = `localhost:${PORT}`;
    try {
        const { networkInterfaces } = await import('os');
        const nets = networkInterfaces();
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                if (net.family === 'IPv4' && !net.internal) {
                    host = `${net.address}:${PORT}`;
                    break;
                }
            }
        }
    } catch(e){}

    const body = `Dear ${name}, your booking for ${service} is confirmed.`;
    
    console.log(`\n====================================`);
    console.log(`📱 SMS CONFIRMATION LOG:`);
    console.log(`To Phone: ${phone}`);
    console.log(`Message: ${body}`);
    
    let sent = false;
    if (process.env.FAST2SMS_API_KEY) {
        console.log(`Sending real SMS via Fast2SMS...`);
        sent = await sendFast2SMSSMS(phone, body);
    } else if (process.env.TWILIO_ACCOUNT_SID) {
        console.log(`Sending real SMS via Twilio...`);
        sent = await sendTwilioSMS(phone, body);
    }
    
    if (sent) {
        console.log(`🟢 Real SMS sent successfully!`);
    } else {
        console.log(`🟡 Real SMS NOT sent: Set FAST2SMS_API_KEY or TWILIO_ACCOUNT_SID env variable to send real SMS.`);
    }
    console.log(`====================================\n`);
};

const sendBookingEmails = async (customerEmail, name, phone, service, message, id) => {
    const brevoSmtpKey = process.env.BREVO_SMTP_KEY;
    const brevoSmtpUser = process.env.BREVO_SMTP_USER || process.env.ADMIN_EMAIL || 'amaykadam2411@gmail.com';
    const adminEmail = process.env.ADMIN_EMAIL || 'amaykadam2411@gmail.com';

    console.log(`\n====================================`);
    console.log(`✉️ BREVO EMAIL NOTIFICATION LOG:`);
    console.log(`Booking ID: #${id}`);
    console.log(`Brevo Login User: ${brevoSmtpUser}`);
    console.log(`Admin Recipient: ${adminEmail}`);
    console.log(`Customer Recipient: ${customerEmail || 'Not provided'}`);

    if (!brevoSmtpKey) {
        console.log(`🟡 Real Emails NOT sent: Set BREVO_SMTP_KEY env variable in Render to send real emails.`);
        console.log(`====================================\n`);
        return;
    }

    const transporter = nodemailer.createTransport({
        host: 'smtp-relay.brevo.com',
        port: 587,
        secure: false,
        auth: {
            user: brevoSmtpUser,
            pass: brevoSmtpKey
        }
    });

    // 1. Send Alert to Admin
    const adminSubject = `🚨 NEW BOOKING REQUEST: #${id} - ${service}`;
    const adminHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0F1115; color: #F0F0F0; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 30px;">
            <div style="text-align: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 20px; margin-bottom: 25px;">
                <h2 style="font-size: 1.8rem; color: #FF6B00; margin: 0; letter-spacing: 2px;">ANANT AMBULANCE</h2>
                <p style="color: #ea580c; font-weight: bold; font-size: 1.1rem; margin: 5px 0 0 0;">🚨 NEW BOOKING ALERT 🚨</p>
            </div>
            
            <h3 style="font-size: 1.3rem; color: #fff; margin-top: 0; font-weight: 600;">Booking Details</h3>
            
            <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 20px; margin: 20px 0; font-size: 0.95rem; line-height: 1.8;">
                <div><span style="color: #8C92A4;">Booking ID:</span> <strong style="color: #fff;">#${id}</strong></div>
                <div><span style="color: #8C92A4;">Patient Name:</span> <strong style="color: #fff;">${name}</strong></div>
                <div><span style="color: #8C92A4;">Phone Number:</span> <strong style="color: #fff;">${phone}</strong></div>
                <div><span style="color: #8C92A4;">Customer Email:</span> <strong style="color: #fff;">${customerEmail || 'Not Provided'}</strong></div>
                <div><span style="color: #8C92A4;">Service Type:</span> <strong style="color: #fff;">${service}</strong></div>
                <div><span style="color: #8C92A4;">Message/Address:</span> <p style="color: #fff; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 4px; margin: 5px 0 0 0;">${message || 'None'}</p></div>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="https://anant-ambulance.onrender.com/admin.html" style="background: #22c55e; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 700; display: inline-block; font-size: 1rem; text-transform: uppercase; letter-spacing: 1px;">
                    💻 Open Admin Dashboard
                </a>
            </div>
        </div>
    `;

    // 1. Send Alert to Admin
    try {
        await transporter.sendMail({
            from: `"Anant Ambulance" <${brevoSmtpUser}>`,
            to: adminEmail,
            subject: adminSubject,
            html: adminHtml
        });
        console.log(`🟢 Brevo Email alert sent to Admin (${adminEmail})!`);
    } catch (e) {
        console.error("Brevo Admin email error:", e.message);
    }

    // 2. Send Confirmation to Customer
    if (customerEmail) {
        const customerSubject = `Booking Confirmed: Anant Ambulance Service #${id}`;
        const customerHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0F1115; color: #F0F0F0; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 30px;">
                <div style="text-align: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 20px; margin-bottom: 25px;">
                    <h2 style="font-size: 2rem; color: #FF6B00; margin: 0; letter-spacing: 2px;">ANANT AMBULANCE</h2>
                    <p style="color: #8C92A4; font-size: 0.9rem; margin: 5px 0 0 0;">Dignified Care & Rapid Emergency Response</p>
                </div>
                
                <h3 style="font-size: 1.4rem; color: #fff; margin-top: 0; font-weight: 600;">Booking Confirmation</h3>
                <p style="color: #A0A5B5; font-size: 1rem; line-height: 1.6;">Dear <strong>${name}</strong>,</p>
                <p style="color: #A0A5B5; font-size: 1rem; line-height: 1.6;">Your booking request for <strong>${service}</strong> has been successfully registered. We are deploying a vehicle to your location immediately.</p>
                
                <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 20px; margin: 25px 0; font-size: 0.95rem; line-height: 1.6;">
                    <div style="margin-bottom: 8px;"><span style="color: #8C92A4;">Booking Reference ID:</span> <strong style="color: #fff;">#${id}</strong></div>
                    <div style="margin-bottom: 8px;"><span style="color: #8C92A4;">Service Selected:</span> <strong style="color: #fff;">${service}</strong></div>
                    <div><span style="color: #8C92A4;">Booking Status:</span> <strong style="color: #4ade80;">🟢 Dispatched & Active</strong></div>
                </div>
                
                <p style="color: #8C92A4; font-size: 0.85rem; text-align: center; margin-top: 35px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 20px;">
                    Need help? Call our 24/7 support line at <a href="tel:+919004805097" style="color: #FF6B00; text-decoration: none; font-weight: 600;">+91 90048 05097</a>.<br>
                    Thank you for choosing Anant Ambulance.
                </p>
            </div>
        `;

        try {
            await transporter.sendMail({
                from: `"Anant Ambulance" <${brevoSmtpUser}>`,
                to: customerEmail,
                subject: customerSubject,
                html: customerHtml
            });
            console.log(`🟢 Brevo Email confirmation sent to Customer (${customerEmail})!`);
        } catch (e) {
            console.error("Brevo Customer email error:", e.message);
        }
    }
    console.log(`====================================\n`);
};

app.post('/api/bookings', (req, res) => {
    const { name, phone, email, service, message, lat, lng } = req.body;
    const query = `INSERT INTO bookings (name, phone, email, service, message) VALUES (?, ?, ?, ?, ?)`;
    db.run(query, [name, phone, email || null, service, message], async function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const bookingId = this.lastID;
        
        // Setup OSRM route
        const originLng = 72.8132;
        const originLat = 18.9657; // Bhatia Hospital, Tardeo
        const destLng = lng || 72.8150; // Default nearby
        const destLat = lat || 18.9680;
        
        let routeJson = '[]';
        let distanceKm = 4.5;
        let durationSec = 150; // Default fast demo time
        const isBusy = Math.random() > 0.5 ? 1 : 0; // 50% chance to be busy with another call
        
        try {
            const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson`;
            const osrmRes = await fetch(osrmUrl);
            const data = await osrmRes.json();
            if (data.routes && data.routes.length > 0) {
                routeJson = JSON.stringify(data.routes[0].geometry.coordinates);
                distanceKm = data.routes[0].distance / 1000;
                durationSec = data.routes[0].duration; // seconds
            }
        } catch (e) {
            console.error("OSRM fetch error:", e);
        }
        
        db.run(`INSERT INTO booking_routes (booking_id, route_json, distance, duration, is_busy) VALUES (?, ?, ?, ?, ?)`, 
            [bookingId, routeJson, distanceKm, durationSec, isBusy]);

        // Trigger SMS
        // sendSMS(phone, name, service, bookingId);

        // Trigger Emails (Both Customer and Admin Alert)
        sendBookingEmails(email, name, phone, service, message, bookingId);
        
        res.status(201).json({ id: bookingId, message: 'Booking successful' });
    });
});

app.post('/api/bookings/:id/driver-location', (req, res) => {
    const id = req.params.id;
    const { lat, lng } = req.body;
    if (lat === undefined || lng === undefined) {
        return res.status(400).json({ error: 'lat and lng are required' });
    }
    db.run(`INSERT INTO driver_locations (booking_id, lat, lng, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(booking_id) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, updated_at=CURRENT_TIMESTAMP`,
        [id, lat, lng],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Driver location updated' });
        }
    );
});

app.get('/api/bookings', (req, res) => {
    db.all(`SELECT * FROM bookings ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

app.get('/api/bookings/:id', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT * FROM bookings WHERE id = ?`, [id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        res.json(row);
    });
});

app.get('/api/bookings/:id/location', (req, res) => {
    const id = req.params.id;
    db.get(`SELECT b.created_at, b.operator_message, r.route_json, r.distance, r.duration, r.is_busy,
                   dl.lat AS driver_lat, dl.lng AS driver_lng, dl.updated_at AS driver_updated
            FROM bookings b 
            LEFT JOIN booking_routes r ON b.id = r.booking_id 
            LEFT JOIN driver_locations dl ON b.id = dl.booking_id
            WHERE b.id = ?`, [id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Not found' });
        
        const createdAt = new Date(row.created_at + 'Z');
        const now = new Date();
        const elapsedSec = (now - createdAt) / 1000;
        
        const isBusy = row.is_busy === 1;
        // If busy, we artificially extend the duration by 2 minutes
        // Set minimum base duration to 180s (3 mins) for a realistic simulation pace
        const baseDuration = Math.max(row.duration || 150, 180);
        const totalDuration = isBusy ? baseDuration + 120 : baseDuration;
        const distanceKm = row.distance || 4.5;
        let routeCoords = [];
        try { routeCoords = JSON.parse(row.route_json || '[]'); } catch(e){}

        let progress = elapsedSec / totalDuration;
        if (progress > 1) progress = 1;
        if (progress < 0) progress = 0;
        
        let point = [18.9657, 72.8132]; // Bhatia default
        let destLat = 18.9680;
        let destLng = 72.8150;
        
        if (routeCoords.length > 0) {
            destLat = routeCoords[routeCoords.length - 1][1];
            destLng = routeCoords[routeCoords.length - 1][0];
        }

        const hasLiveGps = row.driver_lat !== null && row.driver_lng !== null;
        if (hasLiveGps) {
            point = [row.driver_lat, row.driver_lng];
        } else if (routeCoords.length > 0) {
            const index = Math.floor(progress * (routeCoords.length - 1));
            point = [routeCoords[index][1], routeCoords[index][0]];
        }
        
        const remDistance = (distanceKm * (1 - progress)).toFixed(1);
        const remEta = Math.max(1, Math.ceil((totalDuration * (1 - progress)) / 60));
        
        res.json({
            lat: point[0],
            lng: point[1],
            destLat: destLat,
            destLng: destLng,
            progress: progress,
            distance: progress === 1 ? '0.0' : remDistance,
            eta: progress === 1 ? 'Arrived' : remEta,
            isBusy: isBusy,
            isLive: hasLiveGps,
            createdAt: createdAt.toISOString(),
            fullRoute: routeCoords,
            operatorMessage: row.operator_message || ''
        });
    });
});

app.post('/api/bookings/:id/operator-message', (req, res) => {
    const id = req.params.id;
    const { operatorMessage } = req.body;
    db.run(`UPDATE bookings SET operator_message = ? WHERE id = ?`, [operatorMessage, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Operator message updated successfully' });
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Verify Resend configuration on startup
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
        console.log("🟢 Resend Email API is configured and ready to send emails.");
    } else {
        console.log("🟡 RESEND_API_KEY not configured. Email sending is disabled.");
    }
});
