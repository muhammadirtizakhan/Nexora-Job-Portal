import express    from 'express';
import cors       from 'cors';
import { config } from 'dotenv';
import path       from 'path';
import { fileURLToPath } from 'url';

config(); // load .env

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app          = express();
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON;

if (!SUPABASE_URL || !SUPABASE_ANON) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON in .env');
    process.exit(1);
}

app.use(cors());
app.use(express.json());

// ── Serve static files from /public ───────
app.use(express.static(path.join(process.cwd(), 'public')));

// ── Supabase helper ────────────────────────
const sbHeaders = {
    apikey:        SUPABASE_ANON,
    Authorization: `Bearer ${SUPABASE_ANON}`,
    'Content-Type': 'application/json',
};

async function sbFetch(path, options = {}) {
    const url = `${SUPABASE_URL}/rest/v1/${path}`;
    console.log('Fetching:', url);
    
    const res = await fetch(url, {
        ...options,
        headers: {
            'apikey': SUPABASE_ANON,
            'Authorization': `Bearer ${SUPABASE_ANON}`,
            'Content-Type': 'application/json',
        }
    });
    
    console.log('Response status:', res.status);
    
    if (!res.ok) {
        const err = await res.text();
        console.error('Supabase error:', err);
        throw new Error(`Supabase ${res.status}: ${err}`);
    }
    
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

// ── GET /api/projects ──────────────────────
app.get('/api/projects', async (req, res) => {
    try {
        const [projects, roles] = await Promise.all([
            sbFetch('projects?select=*&order=created_at.desc'),
            sbFetch('roles?select=*&order=priority.asc')
        ]);

        const rolesByProject = {};
        roles.forEach(role => {
            const projectId = String(role.project_id);
            if (!rolesByProject[projectId]) rolesByProject[projectId] = [];
            rolesByProject[projectId].push({
                id: role.id,
                role_title: role.role_title || 'Untitled Role',
                category: role.category || 'General',
                description: role.description || '',
                skills: parseSkills(role.skills),
                priority: role.priority || '',
            });
        });

        const data = projects.map(p => ({
            id: p.id,
            title: p.title || 'Untitled Project',
            description: p.description || '',
            image: p.image_url || '',
            completion: p.completion || 0,
            status: p.status || 'Unpaid',
            purpose: p.purpose || 'Practice',
            doc_url: p.doc_url || '#',
            roles: rolesByProject[String(p.id)] || [],
        }));

        res.json({ success: true, data });
    } catch (err) {
        console.error('[/api/projects]', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});
// ── POST /api/users/sync ───────────────────
app.post('/api/users/sync', async (req, res) => {
    try {
        const { firebase_uid, email, display_name } = req.body;
        
        // Better validation
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }
        
        // Agar firebase_uid nahi hai toh temporary banao
        const finalUid = firebase_uid || `temp_${Date.now()}_${Math.random().toString(36)}`;
        
        // Check if exists
        const existing = await sbFetch(`users?email=eq.${email}&select=email`);
        
        if (existing?.length > 0) {
            // Update
            await sbFetch(`users?email=eq.${email}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    firebase_uid: finalUid,
                    display_name: display_name || email.split('@')[0],
                    updated_at: new Date().toISOString()
                })
            });
        } else {
            // Insert
            await sbFetch('users', {
                method: 'POST',
                body: JSON.stringify({
                    firebase_uid: finalUid,
                    email: email,
                    display_name: display_name || email.split('@')[0],
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
            });
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('[/api/users/sync] ERROR:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── PATCH /api/users/update ────────────────
app.patch('/api/users/update', async (req, res) => {
    try {
        const { firebase_uid, ...updates } = req.body;
        if (!firebase_uid) {
            return res.status(400).json({ success: false, error: 'Missing firebase_uid' });
        }

        await sbFetch(`users?firebase_uid=eq.${firebase_uid}`, {
            method:  'PATCH',
            headers: { 'Prefer': 'return=minimal' },
            body:    JSON.stringify(updates)
        });

        res.json({ success: true });
    } catch (err) {
        console.error('[/api/users/update]', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});
app.get('/api/test', async (req, res) => {
    try {
        // Direct Supabase call
        const SUPABASE_URL = 'https://ztghenmbpfetpvwkafno.supabase.co';
        const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0Z2hlbm1icGZldHB2d2thZm5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNjU3NTUsImV4cCI6MjA5NTY0MTc1NX0.sh-8D7d6QmX-fAMIvQtRNZaFoCS2ynm6V5mvWXv7Gvs';
        
        const rolesRes = await fetch(`${SUPABASE_URL}/rest/v1/roles?select=*`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        const roles = await rolesRes.json();
        
        res.json({ 
            success: true, 
            rolesCount: roles.length,
            roles: roles,
            message: 'If you see roles here, problem is in grouping logic'
        });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});
// ── Fallback → serve index/job.html ───────
app.get('*', (req, res) => {
   res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// ── Utils ──────────────────────────────────
function parseSkills(raw) {
    if (!raw) return [];
    const str = String(raw).trim();
    if (str.startsWith('[')) { try { return JSON.parse(str); } catch (_) {} }
    return str.split(',').map(s => s.trim()).filter(Boolean);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Nexora API running → http://localhost:${PORT}`);
});
