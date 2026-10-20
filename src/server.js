import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { createRoom, createUser, db, deleteUser, roomForUser, roomsForUser, savePermission, updateUser, userByEmail, userById, userForPermission, users } from './db.js';

dotenv.config();
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { transports: ['websocket', 'polling'] });
const port = Number(process.env.PORT || 3000);
const cookieName = 'screen_session';
const jwtSecret = process.env.JWT_SECRET || 'development-secret-change-me';
const activeStreams = new Map();
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../client/dist');

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

function session(req) {
  const token = req.cookies?.[cookieName];
  if (!token) return null;
  try { const payload = jwt.verify(token, jwtSecret); return userById(Number(payload.sub)); } catch { return null; }
}
function auth(req, res, next) { const user = session(req); if (!user) return res.status(401).json({ error: 'Authentication required' }); req.user = user; next(); }
function admin(req, res, next) { if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Administrator access required' }); next(); }
function roomAuth(req, res, next) { const room = roomForUser(req.params.slug, req.user.id); if (!room) return res.status(403).json({ error: 'Room access denied' }); req.room = room; next(); }
const sign = (user) => jwt.sign({ sub: String(user.id), email: user.email }, jwtSecret, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
const cookieOptions = () => ({ httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 8 * 3600000, path: '/' });

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = userByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid credentials' });
    res.cookie(cookieName, sign(user), cookieOptions()).json({ user: { id: user.id, email: user.email, role: user.role } });
  } catch (error) { next(error); }
});
app.post('/api/auth/logout', (_req, res) => res.clearCookie(cookieName, { ...cookieOptions(), maxAge: undefined }).status(204).end());
app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));
app.get('/api/admin/users', auth, admin, (_req, res) => res.json({ users: users() }));
app.post('/api/admin/users', auth, admin, async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const role = req.body?.role === 'ADMIN' ? 'ADMIN' : 'USER';
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return res.status(400).json({ error: 'A valid email and password with at least 8 characters are required' });
    const result = createUser({ email, passwordHash: await bcrypt.hash(password, 12), role });
    res.status(201).json({ user: { id: Number(result.lastInsertRowid), email, role } });
  } catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Email is already registered' }); next(error); }
});
app.patch('/api/admin/users/:id', auth, admin, async (req, res, next) => {
  try {
    const id = Number(req.params.id); const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''; const role = req.body?.role; const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!Number.isInteger(id) || !/^\S+@\S+\.\S+$/.test(email) || !['ADMIN', 'USER'].includes(role) || (password && password.length < 8)) return res.status(400).json({ error: 'Valid email, role and optional password with at least 8 characters are required' });
    if (id === req.user.id && role !== 'ADMIN') return res.status(400).json({ error: 'You cannot remove your own administrator access' });
    if (!userById(id)) return res.status(404).json({ error: 'User not found' });
    updateUser(id, { email, role, passwordHash: password ? await bcrypt.hash(password, 12) : undefined });
    res.json({ user: { id, email, role } });
  } catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Email is already registered' }); next(error); }
});
app.delete('/api/admin/users/:id', auth, admin, (req, res, next) => {
  try {
    const id = Number(req.params.id); if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id' });
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    if (!userById(id)) return res.status(404).json({ error: 'User not found' });
    deleteUser(id); res.status(204).end();
  } catch (error) { if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(409).json({ error: 'User owns a room and cannot be deleted' }); next(error); }
});
app.get('/api/rooms', auth, (req, res) => res.json({ rooms: roomsForUser(req.user.id) }));
app.post('/api/rooms', auth, (req, res, next) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const slug = typeof req.body?.slug === 'string' ? req.body.slug.trim().toLowerCase() : '';
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Room name must contain 2 to 80 characters' });
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 64) return res.status(400).json({ error: 'Slug must use lowercase letters, numbers and hyphens' });
    const room = createRoom({ name, slug, ownerId: req.user.id });
    res.status(201).json({ room });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That room slug is already in use' });
    next(error);
  }
});
app.get('/api/rooms/:slug', auth, roomAuth, (req, res) => res.json({ room: req.room }));
app.post('/api/rooms/:slug/permissions', auth, roomAuth, (req, res) => {
  if (req.room.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can manage permissions' });
  const requestedId = Number(req.body?.userId); const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''; const role = req.body?.role;
  if ((!Number.isInteger(requestedId) && !email) || !['HOST', 'VIEWER'].includes(role)) return res.status(400).json({ error: 'email or userId and role HOST or VIEWER are required' });
  const target = email ? userByEmail(email) : userForPermission(requestedId); if (!target) return res.status(404).json({ error: 'User not found' });
  const userId = target.id;
  savePermission(req.room.id, userId, role);
  res.status(201).json({ permission: { roomId: req.room.id, userId, email: target.email, role } });
});
app.get('/api/webrtc-config', auth, (_req, res) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) iceServers.push({ urls: process.env.TURN_URL, username: process.env.TURN_USER, credential: process.env.TURN_PASS });
  res.json({ iceServers });
});

function socketUser(socket) {
  const value = (socket.handshake.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  if (!value) throw new Error('Authentication required');
  const payload = jwt.verify(decodeURIComponent(value.slice(cookieName.length + 1)), jwtSecret);
  const user = userById(Number(payload.sub)); if (!user) throw new Error('Authentication required'); return user;
}
io.use((socket, next) => { try { socket.user = socketUser(socket); next(); } catch { next(new Error('Authentication required')); } });
const channel = (slug) => `room:${slug}`;
function targetFor(socket, id) { const target = io.sockets.sockets.get(id); return target && target.data.slug === socket.data.slug ? target : null; }
function stopStream(socket) { if (activeStreams.get(socket.data.slug) !== socket.id) return false; activeStreams.delete(socket.data.slug); io.to(channel(socket.data.slug)).emit('stream-stopped', { broadcasterId: socket.id }); return true; }

io.on('connection', (socket) => {
  socket.on('join-room', (data, ack = () => {}) => {
    const slug = typeof data?.slug === 'string' ? data.slug.trim() : '';
    const room = slug && roomForUser(slug, socket.user.id);
    if (!room) return ack({ ok: false, error: 'Room access denied' });
    if (socket.data.slug) socket.leave(channel(socket.data.slug));
    socket.join(channel(slug)); socket.data.slug = slug; socket.data.role = room.role;
    const broadcasterId = activeStreams.get(slug) || null;
    socket.emit('room-joined', { room, role: room.role, broadcasterId, hostId: broadcasterId });
    if (broadcasterId && broadcasterId !== socket.id) { io.to(broadcasterId).emit('viewer-joined', { viewerId: socket.id }); socket.emit('stream-available', { broadcasterId, hostId: broadcasterId }); }
    ack({ ok: true, room, role: room.role, broadcasterId, hostId: broadcasterId });
  });
  socket.on('start-stream', (_data, ack = () => {}) => {
    if (!socket.data.slug) return ack({ ok: false, error: 'Join a room before sharing' });
    const previousBroadcasterId = activeStreams.get(socket.data.slug);
    if (previousBroadcasterId && previousBroadcasterId !== socket.id) io.to(previousBroadcasterId).emit('stream-replaced', { broadcasterId: socket.id });
    activeStreams.set(socket.data.slug, socket.id); socket.to(channel(socket.data.slug)).emit('stream-started', { broadcasterId: socket.id, hostId: socket.id });
    for (const peerId of io.sockets.adapter.rooms.get(channel(socket.data.slug)) || []) if (peerId !== socket.id) socket.emit('viewer-joined', { viewerId: peerId });
    ack({ ok: true });
  });
  socket.on('stop-stream', (_data, ack = () => {}) => ack({ ok: stopStream(socket) }));
  socket.on('webrtc-offer', (data) => { if (activeStreams.get(socket.data.slug) !== socket.id) return; const target = targetFor(socket, data?.targetId); if (target) target.emit('webrtc-offer', { fromId: socket.id, description: data.description }); });
  socket.on('webrtc-answer', (data) => { const target = targetFor(socket, data?.targetId); if (target) target.emit('webrtc-answer', { fromId: socket.id, description: data.description }); });
  socket.on('webrtc-ice-candidate', (data) => { const target = targetFor(socket, data?.targetId); if (target) target.emit('webrtc-ice-candidate', { fromId: socket.id, candidate: data.candidate }); });
  socket.on('disconnect', () => { stopStream(socket); if (socket.data.slug) socket.to(channel(socket.data.slug)).emit('peer-left', { peerId: socket.id }); });
});

if (process.env.NODE_ENV !== 'test') {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html'), (error) => { if (error && !res.headersSent) res.status(404).json({ error: 'Not found' }); }));
}
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: 'Internal server error' }); });
const server = httpServer.listen(port, () => console.log(`Screen Share listening on http://localhost:${port}`));
function shutdown() { io.close(); server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
