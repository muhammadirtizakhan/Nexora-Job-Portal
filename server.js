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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...options,
        headers: { ...sbHeaders, ...(options.headers || {}) }
    });
    if (!res.ok) {
        const err = await res.text();
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

        // Debug: Check if roles are fetched
        console.log('Fetched roles count:', roles.length);
        console.log('First role:', roles[0]);

        const rolesByProject = {};
        roles.forEach(role => {
            // CRITICAL: Convert to string for matching
            const projectId = String(role.project_id);
            if (!rolesByProject[projectId]) rolesByProject[projectId] = [];
            rolesByProject[projectId].push({
                id:          role.id,
                role_title:  role.role_title,
                category:    role.category,
                description: role.description,
                skills:      parseSkills(role.skills),
                priority:    role.priority,
            });
        });

        console.log('Roles by project keys:', Object.keys(rolesByProject));

        const data = projects.map(p => ({
            id:          p.id,
            title:       p.title,
            description: p.description,
            image:       p.image_url,
            completion:  p.completion,
            status:      p.status,
            purpose:     p.purpose,
            doc_url:     p.doc_url,
            // CRITICAL: Convert project id to string
            roles:       rolesByProject[String(p.id)] || [],
        }));

        console.log('Project roles count:', data[0]?.roles.length);

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
        if (!firebase_uid || !email) {
            return res.status(400).json({ success: false, error: 'Missing firebase_uid or email' });
        }

        const existing = await sbFetch(`users?firebase_uid=eq.${firebase_uid}&select=firebase_uid`);
        if (existing?.length > 0) {
            return res.json({ success: true, exists: true });
        }

        await sbFetch('users', {
            method:  'POST',
            headers: { 'Prefer': 'return=minimal' },
            body:    JSON.stringify({
                firebase_uid,
                email,
                display_name: display_name || email.split('@')[0]
            })
        });

        res.json({ success: true, exists: false });
    } catch (err) {
        console.error('[/api/users/sync]', err.message);
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
