import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const GRID_SIZE = 10;
const CELL_SIZE = 48;
const INIT_POS = { x: 0, y: 0 };
const PROXIMITY_THRESHOLD = 2; // Manhattan distance

const RoomPage = ({ user, avatar, token }) => {
    const [users, setUsers] = useState([]);
    const [position, setPosition] = useState(INIT_POS);
    const [proximity, setProximity] = useState({}); // { socketId: true/false }
    const [audioStreams, setAudioStreams] = useState({}); // { socketId: MediaStream }
    const socketRef = useRef(null);
    const peersRef = useRef({}); // { socketId: RTCPeerConnection }
    const localStreamRef = useRef(null);

    // Connect to WebSocket and handle events
    useEffect(() => {
        const socket = io('https://twod-room-voicechat.onrender.com', { transports: ['websocket'] });
        socketRef.current = socket;
        socket.emit('join', {
            token,
            avatarId: avatar.id,
            position: INIT_POS
        });
        socket.on('roomUsers', setUsers);
        // WebRTC signaling
        socket.on('signal', async ({ from, signal }) => {
            if (!peersRef.current[from]) {
                await createPeerConnection(from, false);
            }
            const peer = peersRef.current[from];
            if (signal.sdp) {
                await peer.setRemoteDescription(new window.RTCSessionDescription(signal.sdp));
                if (signal.sdp.type === 'offer') {
                    const answer = await peer.createAnswer();
                    await peer.setLocalDescription(answer);
                    socket.emit('signal', { to: from, signal: { sdp: peer.localDescription } });
                }
            } else if (signal.candidate) {
                await peer.addIceCandidate(new window.RTCIceCandidate(signal.candidate));
            }
        });
        return () => {
            socket.disconnect();
            Object.values(peersRef.current).forEach(pc => pc.close());
            setAudioStreams({});
        };
    }, [token, avatar]);

    // Handle movement
    useEffect(() => {
        const handleKey = (e) => {
            let { x, y } = position;
            if (e.key === 'ArrowUp' || e.key === 'w') y = Math.max(0, y - 1);
            if (e.key === 'ArrowDown' || e.key === 's') y = Math.min(GRID_SIZE - 1, y + 1);
            if (e.key === 'ArrowLeft' || e.key === 'a') x = Math.max(0, x - 1);
            if (e.key === 'ArrowRight' || e.key === 'd') x = Math.min(GRID_SIZE - 1, x + 1);
            if (x !== position.x || y !== position.y) {
                setPosition({ x, y });
                socketRef.current.emit('move', { position: { x, y } });
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [position]);

    // Proximity detection and WebRTC: manage connections based on proximity
    useEffect(() => {
        const me = users.find(u => u.email === user.email);
        if (!me) return;
        const prox = {};
        users.forEach(u => {
            if (u.email === user.email) return;
            const dist = Math.abs((u.position?.x ?? 0) - (me.position?.x ?? 0)) + Math.abs((u.position?.y ?? 0) - (me.position?.y ?? 0));
            prox[u.socketId] = dist <= PROXIMITY_THRESHOLD;
        });
        setProximity(prox);

        // WebRTC connection/disconnection logic
        if (!localStreamRef.current) {
            navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
                localStreamRef.current = stream;
            }).catch(() => { });
        }
        Object.entries(prox).forEach(async ([socketId, inProx]) => {
            if (inProx && !peersRef.current[socketId]) {
                // Only initiate if my socketId is less than theirs
                if (me.socketId < socketId) {
                    await createPeerConnection(socketId, true);
                }
            } else if (!inProx && peersRef.current[socketId]) {
                peersRef.current[socketId].close();
                delete peersRef.current[socketId];
                setAudioStreams(s => {
                    const copy = { ...s };
                    delete copy[socketId];
                    return copy;
                });
            }
        });
    }, [users, user.email]);

    // Create peer connection
    async function createPeerConnection(socketId, isInitiator) {
        const pc = new window.RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        peersRef.current[socketId] = pc;
        // Add local audio
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));
        }
        // ICE candidates
        pc.onicecandidate = (e) => {
            if (e.candidate) {
                socketRef.current.emit('signal', { to: socketId, signal: { candidate: e.candidate } });
            }
        };
        // Remote stream
        pc.ontrack = (e) => {
            setAudioStreams(s => ({ ...s, [socketId]: e.streams[0] }));
        };
        // Offer/Answer
        if (isInitiator) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socketRef.current.emit('signal', { to: socketId, signal: { sdp: pc.localDescription } });
        }
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                pc.close();
                delete peersRef.current[socketId];
                setAudioStreams(s => {
                    const copy = { ...s };
                    delete copy[socketId];
                    return copy;
                });
            }
        };
    }

    // User list sidebar
    const userList = (
        <div style={{ position: 'absolute', right: -220, top: 0, width: 200, background: '#f8f8f8', border: '1px solid #ccc', padding: 10, borderRadius: 8 }}>
            <b>Users in Room:</b>
            <ul style={{ listStyle: 'none', padding: 0 }}>
                {users.map(u => (
                    <li key={u.socketId} style={{ margin: '8px 0', color: u.email === user.email ? '#1976d2' : '#333' }}>
                        <img src={`https://twod-room-voicechat.onrender.com/avatars/${['cat', 'dog', 'robot', 'alien'][u.avatar - 1]}.png`} alt={u.name} width={24} height={24} style={{ verticalAlign: 'middle', borderRadius: 4, marginRight: 6 }} />
                        {u.name} {u.email === user.email && '(You)'}
                    </li>
                ))}
            </ul>
        </div>
    );

    // Handle grid click
    const handleGridClick = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / CELL_SIZE);
        const y = Math.floor((e.clientY - rect.top) / CELL_SIZE);
        if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
            setPosition({ x, y });
            socketRef.current.emit('move', { position: { x, y } });
        }
    };

    // Handle grid touch (for mobile)
    const handleGridTouch = (e) => {
        const touch = e.changedTouches[0];
        const rect = e.currentTarget.getBoundingClientRect();
        const x = Math.floor((touch.clientX - rect.left) / CELL_SIZE);
        const y = Math.floor((touch.clientY - rect.top) / CELL_SIZE);
        if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
            setPosition({ x, y });
            socketRef.current.emit('move', { position: { x, y } });
        }
    };

    // Render grid and avatars
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h2>Room</h2>
            <div style={{ position: 'relative', width: GRID_SIZE * CELL_SIZE + 200, height: GRID_SIZE * CELL_SIZE, margin: '20px auto', background: '#fafafa', display: 'flex' }}>
                <div style={{ position: 'relative', width: GRID_SIZE * CELL_SIZE, height: GRID_SIZE * CELL_SIZE, border: '2px solid #333', background: '#fafafa' }}
                    onClick={handleGridClick}
                    onTouchEnd={handleGridTouch}
                >
                    {/* Render all users */}
                    {users.map(u => {
                        const isMe = u.email === user.email;
                        const pos = u.position || INIT_POS;
                        const imgSrc = `https://twod-room-voicechat.onrender.com/avatars/${['cat', 'dog', 'robot', 'alien'][u.avatar - 1]}.png`;
                        const inProx = proximity[u.socketId];
                        return (
                            <div key={u.socketId}
                                style={{
                                    position: 'absolute',
                                    left: pos.x * CELL_SIZE,
                                    top: pos.y * CELL_SIZE,
                                    width: CELL_SIZE,
                                    height: CELL_SIZE,
                                    textAlign: 'center',
                                    zIndex: isMe ? 2 : 1,
                                    filter: inProx ? 'drop-shadow(0 0 8px lime)' : 'none',
                                    background: isMe ? 'rgba(25,118,210,0.08)' : 'none',
                                    borderRadius: 10,
                                    boxShadow: isMe ? '0 0 8px #1976d2' : 'none',
                                    transition: 'box-shadow 0.2s, filter 0.2s'
                                }}>
                                <img src={imgSrc} alt={u.name} width={CELL_SIZE - 8} height={CELL_SIZE - 8} style={{ border: isMe ? '2px solid #1976d2' : '1px solid gray', borderRadius: 8, background: '#fff' }} />
                                <div style={{ fontSize: 12 }}>{u.name}</div>
                                {inProx && <div style={{ color: 'lime', fontSize: 10 }}>In Proximity</div>}
                                {/* Audio element for voice chat */}
                                {audioStreams[u.socketId] && <audio autoPlay ref={el => { if (el) el.srcObject = audioStreams[u.socketId]; }} />}
                            </div>
                        );
                    })}
                </div>
                {userList}
            </div>
            <div style={{ marginTop: 10 }}>Use <b>arrow keys</b> or <b>WASD</b> to move your avatar. <span style={{ color: 'lime' }}>Voice chat</span> is enabled when avatars are close.</div>
        </div>
    );
};

export default RoomPage; 