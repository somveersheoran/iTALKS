import React, { useState, useEffect, useRef } from 'react';
import EmojiPicker from 'emoji-picker-react';
import './App.css';

import { auth } from './firebase';
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
const [confirmationResult, setConfirmationResult] = useState(null);

const servers = { iceServers: [{ urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }] };

// 🛑 DYNAMIC API URLs (Localhost hat gaya!)
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  
  // --- OTP AUTH STATES ---
  const [authStep, setAuthStep] = useState(1); 
  const [countryCode, setCountryCode] = useState("+91");
  const [authPhone, setAuthPhone] = useState("");
  const [authOtp, setAuthOtp] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [confirmationResult, setConfirmationResult] = useState(null); // Firebase handle

  // --- PROFILE & ABOUT STATE ---
  const [showProfileView, setShowProfileView] = useState(false);
  const [isEditingAbout, setIsEditingAbout] = useState(false);
  const [aboutText, setAboutText] = useState("");
  const profileInputRef = useRef(null);

  // --- STATUS & TAB STATE ---
  const [sidebarTab, setSidebarTab] = useState("chats");
  const [statuses, setStatuses] = useState([]);
  const [activeStatus, setActiveStatus] = useState(null);
  const statusInputRef = useRef(null);

  // --- CHAT & WEBRTC STATES ---
  const [activeChat, setActiveChat] = useState("Global Chat");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [showEmojis, setShowEmojis] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [inCall, setInCall] = useState(false);

  const ws = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const fileInputRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);

  // ==========================================
  // 1. AUTHENTICATION LOGIC (OTP)
  // ==========================================
  const requestOTP = async (e) => {
    e.preventDefault();
    try {
      if (!window.recaptchaVerifier) {
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { 'size': 'invisible' });
      }
      // Firebase se SMS bhej rahe hain, backend `/send-otp` ki ab zaroorat nahi hai
      const confirmation = await signInWithPhoneNumber(auth, countryCode + authPhone, window.recaptchaVerifier);
      setConfirmationResult(confirmation);
      setAuthStep(2);
    } catch (err) { 
      alert("Error sending OTP: " + err.message); 
      console.error(err); 
    }
  };

  const verifyOTP = async (e) => {
    e.preventDefault();
    try {
      let phoneNumber;
      if (authStep === 2) {
        const result = await confirmationResult.confirm(authOtp);
        phoneNumber = result.user.phoneNumber;
      } else {
        phoneNumber = countryCode + authPhone;
      }
      
      const response = await fetch(`${API_BASE_URL}/verify-otp`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneNumber, username: authUsername })
      });
      const data = await response.json();
      if (data.isNewUser) setAuthStep(3);
      else { setCurrentUser(data); setAboutText(data.about || "Hey! I am using iTALKS"); }
    } catch (err) { alert("Invalid OTP!"); }
  };
  // ==========================================
  // 2. PROFILE & STATUS UPLOAD LOGIC
  // ==========================================
  const handleProfilePictureUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onloadend = async () => {
        const base64Image = reader.result;
        setCurrentUser(prev => ({ ...prev, avatar: base64Image }));
        await fetch(`${API_BASE_URL}/update-profile`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: currentUser.clientId, avatar: base64Image })
        });
      };
    }
  };

  const saveAboutText = async () => {
    setIsEditingAbout(false);
    setCurrentUser(prev => ({ ...prev, about: aboutText }));
    await fetch(`${API_BASE_URL}/update-profile`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: currentUser.clientId, about: aboutText })
    });
  };

  const handleStatusUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onloadend = () => {
        const statusData = { username: currentUser.username, avatar: currentUser.avatar, content: reader.result, type: file.type.startsWith('video') ? 'video' : 'image', timestamp: new Date().toISOString() };
        ws.current.send(JSON.stringify({ type: 'new_status', ...statusData }));
        setStatuses(prev => [statusData, ...prev]);
      };
    }
  };

  // ==========================================
  // 3. WEBSOCKET & MESSAGING LOGIC
  // ==========================================
  useEffect(() => {
    if (!currentUser) return;
    
    fetch(`${API_BASE_URL}/messages`)
      .then(res => res.json())
      .then(data => setMessages(data.map(m => ({...m, sender: String(m.clientId) === String(currentUser.clientId) ? 'me' : 'them'}))))
      .catch(console.error);
      
    fetch(`${API_BASE_URL}/statuses`)
      .then(res => res.json())
      .then(setStatuses)
      .catch(console.error);

    ws.current = new WebSocket(`${WS_BASE_URL}/ws`);
    ws.current.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "read_receipt") {
        setMessages(prev => prev.map(m => m.id === data.message_id ? { ...m, is_read: true } : m));
      } else if (data.type === "new_status") {
        setStatuses(prev => [data, ...prev]);
      } else {
        if (['text', 'audio', 'image'].includes(data.type)) {
          if (String(data.clientId) !== String(currentUser.clientId)) {
            setMessages(prev => [...prev, { ...data, sender: 'them' }]);
            if (data.id) {
              ws.current.send(JSON.stringify({ type: "read_receipt", message_id: data.id }));
            }
          }
        } 
        else if (data.type === 'call_offer') {
          if (window.confirm(`Incoming video call! Accept?`)) await answerCall(data.offer);
        } else if (data.type === 'call_answer') {
          if (peerConnectionRef.current) await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
        } else if (data.type === 'ice_candidate') {
          if (peerConnectionRef.current) {
            try { await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
          }
        }
      }
    };
    return () => ws.current.close();
  }, [currentUser]);

  const sendMessage = () => {
    if (input.trim() !== "" && ws.current) {
      const payload = { clientId: currentUser.clientId, type: 'text', content: input };
      ws.current.send(JSON.stringify(payload));
      setMessages(prev => [...prev, { ...payload, sender: 'me' }]);
      setInput("");
      setShowEmojis(false);
    }
  };

  const onEmojiClick = (emojiObject) => setInput(prev => prev + emojiObject.emoji);
  
  const handleImageUpload = (e) => { 
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onloadend = () => {
        const payload = { clientId: currentUser.clientId, type: 'image', content: reader.result };
        ws.current.send(JSON.stringify(payload));
        setMessages(prev => [...prev, { ...payload, sender: 'me' }]);
      };
    }
  };

  const startRecording = async () => { 
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = () => {
        const reader = new FileReader();
        reader.readAsDataURL(new Blob(audioChunksRef.current, { type: 'audio/webm' }));
        reader.onloadend = () => {
          const payload = { clientId: currentUser.clientId, type: 'audio', content: reader.result };
          ws.current.send(JSON.stringify(payload));
          setMessages((prev) => [...prev, { ...payload, sender: 'me' }]);
        };
      };
      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) { alert("Please allow microphone access!"); }
  };
  const stopRecording = () => { if (mediaRecorderRef.current) { mediaRecorderRef.current.stop(); setIsRecording(false); } };
  
  const setupMedia = async () => { 
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    remoteStreamRef.current = new MediaStream();
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStreamRef.current;
    peerConnectionRef.current = new RTCPeerConnection(servers);
    localStreamRef.current.getTracks().forEach(track => peerConnectionRef.current.addTrack(track, localStreamRef.current));
    peerConnectionRef.current.ontrack = (event) => event.streams[0].getTracks().forEach(track => remoteStreamRef.current.addTrack(track));
    peerConnectionRef.current.onicecandidate = (event) => {
      if (event.candidate) ws.current.send(JSON.stringify({ clientId: currentUser.clientId, type: 'ice_candidate', candidate: event.candidate }));
    };
  };
  const startVideoCall = async () => { 
    setInCall(true); await setupMedia();
    const offer = await peerConnectionRef.current.createOffer();
    await peerConnectionRef.current.setLocalDescription(offer);
    ws.current.send(JSON.stringify({ clientId: currentUser.clientId, type: 'call_offer', offer: offer }));
  };
  const answerCall = async (offer) => { 
    setInCall(true); await setupMedia();
    await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnectionRef.current.createAnswer();
    await peerConnectionRef.current.setLocalDescription(answer);
    ws.current.send(JSON.stringify({ clientId: currentUser.clientId, type: 'call_answer', answer: answer }));
  };
  const endCall = () => { 
    if (peerConnectionRef.current) peerConnectionRef.current.close();
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => track.stop());
    setInCall(false);
  };

  // ==========================================
  // UI RENDER: AUTHENTICATION SCREEN
  // ==========================================
  if (!currentUser) {
    return (
      <div className="auth-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#626262' }}>
        <div className="auth-box" style={{ width: '350px', padding: '40px', background: 'white', textAlign: 'center', borderRadius: '8px' }}>
          <h1 style={{ color: '#095f4c', fontSize: '40px' }}>iTALKS</h1>
          {authStep === 1 && (
            <form onSubmit={requestOTP}>
              <div id="recaptcha-container"></div>
              <select value={countryCode} onChange={e => setCountryCode(e.target.value)}>
                <option value="+91">IN +91</option><option value="+1">US +1</option>
              </select>
              <input type="tel" placeholder="Phone Number" value={authPhone} onChange={e => setAuthPhone(e.target.value)} required />
              <button type="submit">Next</button>
            </form>
          )}
          {authStep === 2 && (
            <form onSubmit={verifyOTP}>
              <input type="text" placeholder="Enter OTP" value={authOtp} onChange={e => setAuthOtp(e.target.value)} required />
              <button type="submit">Verify</button>
            </form>
          )}
          {authStep === 3 && (
            <form onSubmit={verifyOTP}>
              <input type="text" placeholder="Enter Name" value={authUsername} onChange={e => setAuthUsername(e.target.value)} required />
              <button type="submit">Save</button>
            </form>
          )}
        </div>
      </div>
    );
  }
  // ==========================================
  // UI RENDER: MAIN CHAT APP
  // ==========================================
  return (
    <div className="app-container">
      
      {/* STATUS OVERLAY */}
      {activeStatus && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.95)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', top: '20px', right: '30px', color: 'white', fontSize: '30px', cursor: 'pointer' }} onClick={() => setActiveStatus(null)}>✖</div>
          <div style={{ display: 'flex', alignItems: 'center', position: 'absolute', top: '20px', left: '20px' }}>
            <img src={activeStatus.avatar || "https://via.placeholder.com/40"} alt="User" style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', marginRight: '10px' }} />
            <span style={{ color: 'white', fontWeight: 'bold', fontSize: '18px' }}>{activeStatus.username}</span>
          </div>
          {activeStatus.type === 'video' ? (
            <video src={activeStatus.content} autoPlay controls style={{ maxWidth: '90%', maxHeight: '80vh', borderRadius: '10px' }} />
          ) : (
            <img src={activeStatus.content} alt="Status" style={{ maxWidth: '90%', maxHeight: '80vh', borderRadius: '10px' }} />
          )}
        </div>
      )}

      <div className="whatsapp-clone">
        
        {/* LEFT SIDEBAR AREA */}
        <div className="sidebar">
          {showProfileView ? (
             <div className="profile-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#f0f2f5' }}>
               <div className="profile-panel-header" onClick={() => setShowProfileView(false)} style={{ backgroundColor: '#008069', color: 'white', padding: '20px', display: 'flex', alignItems: 'center', gap: '15px', cursor: 'pointer' }}>
                 <span style={{ fontSize: '20px' }}>←</span>
                 <span style={{ fontSize: '18px', fontWeight: 'bold' }}>Profile</span>
               </div>
               
               <div className="profile-pic-container" style={{ textAlign: 'center', padding: '30px 0' }}>
                 <input type="file" accept="image/*" style={{ display: 'none' }} ref={profileInputRef} onChange={handleProfilePictureUpload} />
                 <div className="profile-pic-large" onClick={() => profileInputRef.current.click()} style={{ width: '200px', height: '200px', margin: '0 auto', cursor: 'pointer', borderRadius: '50%', backgroundColor: '#dfe5e7', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                   {currentUser.avatar ? <img src={currentUser.avatar} alt="Profile" style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : <span style={{fontSize: '80px'}}>👤</span>}
                 </div>
               </div>

               <div className="profile-info" style={{ backgroundColor: 'white', padding: '20px', marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                 <p style={{ fontSize: '14px', color: '#008069', marginBottom: '10px' }}>Your Name</p>
                 <h2 style={{ fontWeight: '400', color: '#3b4a54' }}>{currentUser.username}</h2>
               </div>

               <div className="profile-about" style={{ backgroundColor: 'white', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                 <p style={{ fontSize: '14px', color: '#008069', marginBottom: '10px' }}>About</p>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                   {isEditingAbout ? (
                     <input autoFocus type="text" value={aboutText} onChange={e => setAboutText(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveAboutText()} style={{ flex: 1, border: 'none', borderBottom: '2px solid #008069', outline: 'none', fontSize: '16px', padding: '5px 0' }} />
                   ) : (
                     <span style={{ fontSize: '16px', color: '#3b4a54' }}>{currentUser.about}</span>
                   )}
                   <button onClick={() => isEditingAbout ? saveAboutText() : setIsEditingAbout(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}>
                     {isEditingAbout ? "✅" : "✏️"}
                   </button>
                 </div>
               </div>
             </div>
          ) : (
            <>
              {/* NORMAL SIDEBAR HEADER */}
              <div className="sidebar-header">
                <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => setShowProfileView(true)}>
                  <div className="avatar">
                    {currentUser.avatar ? <img src={currentUser.avatar} alt="Profile" style={{width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover'}} /> : "👤"}
                  </div>
                  <span style={{ fontWeight: '500' }}>{currentUser.username}</span>
                </div>
                <div>
                  <button className="icon-btn" style={{ fontSize: '18px' }} onClick={() => setCurrentUser(null)}>🚪</button>
                </div>
              </div>

              {/* TABS FOR CHATS OR STATUS */}
              <div style={{ display: 'flex', backgroundColor: '#f0f2f5', borderBottom: '1px solid #ddd' }}>
                <div style={{ flex: 1, textAlign: 'center', padding: '12px', cursor: 'pointer', fontWeight: 'bold', color: sidebarTab === 'chats' ? '#00a884' : '#54656f', borderBottom: sidebarTab === 'chats' ? '3px solid #00a884' : 'none' }} onClick={() => setSidebarTab('chats')}>Chats</div>
                <div style={{ flex: 1, textAlign: 'center', padding: '12px', cursor: 'pointer', fontWeight: 'bold', color: sidebarTab === 'status' ? '#00a884' : '#54656f', borderBottom: sidebarTab === 'status' ? '3px solid #00a884' : 'none' }} onClick={() => setSidebarTab('status')}>Status</div>
              </div>

              {sidebarTab === 'chats' ? (
                <>
                  <div className="sidebar-search">
                    <div className="search-wrapper">
                      <span style={{color: '#54656f', fontSize: '14px'}}>🔍</span>
                      <input type="text" placeholder="Search or start a new chat" />
                    </div>
                  </div>
                  <div className="contact-list">
                    <div className="contact-item" onClick={() => setActiveChat("Global Chat")}>
                      <div className="avatar" style={{backgroundColor: '#1EBEA5', color: 'white'}}>🌐</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <h4 style={{ fontWeight: '400', color: '#111b21' }}>Global Chat</h4>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="status-list" style={{ flex: 1, overflowY: 'auto' }}>
                  <div className="contact-item" onClick={() => statusInputRef.current.click()} style={{ padding: '15px' }}>
                    <div className="avatar" style={{ border: '2px dashed #00a884', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e6f8f5' }}>
                      <span style={{ color: '#00a884', fontSize: '20px', fontWeight: 'bold' }}>+</span>
                    </div>
                    <div style={{ flex: 1, marginLeft: '15px' }}>
                      <h4 style={{ fontWeight: '500', color: '#111b21', margin: 0 }}>My Status</h4>
                      <p style={{ fontSize: '13px', color: '#667781', margin: 0 }}>Tap to add status update</p>
                    </div>
                    <input type="file" accept="image/*,video/*" style={{ display: 'none' }} ref={statusInputRef} onChange={handleStatusUpload} />
                  </div>
                  <p style={{ padding: '10px 15px', color: '#008069', fontSize: '14px', fontWeight: 'bold', margin: 0 }}>RECENT UPDATES</p>
                  
                  {statuses.map((s, i) => (
                    <div key={i} className="contact-item" onClick={() => setActiveStatus(s)} style={{ padding: '15px' }}>
                      <div className="avatar" style={{ border: '2px solid #00a884', padding: '2px' }}>
                        {s.avatar ? <img src={s.avatar} alt="Avatar" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : "👤"}
                      </div>
                      <div style={{ flex: 1, marginLeft: '15px' }}>
                        <h4 style={{ fontWeight: '500', color: '#111b21', margin: 0 }}>{s.username}</h4>
                        <p style={{ fontSize: '13px', color: '#667781', margin: 0 }}>{new Date(s.timestamp).toLocaleTimeString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* RIGHT CHAT WINDOW */}
        <div className="chat-window">
          
          <div className="chat-header">
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div className="avatar" style={{backgroundColor: '#1EBEA5', color: 'white'}}>🌐</div>
              <span style={{ fontWeight: '500' }}>{activeChat}</span>
            </div>
            <button className="icon-btn" onClick={startVideoCall}>📹</button>
          </div>

          {/* WEBRTC VIDEO CALL OVERLAY */}
          {inCall && (  
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#111', zIndex: 2000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
               <h2 style={{ color: 'white', marginBottom: '20px' }}>In Call</h2>
              <div style={{ display: 'flex', gap: '20px' }}>
                <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '400px', height: '300px', backgroundColor: 'black', borderRadius: '10px', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '400px', height: '300px', backgroundColor: '#333', borderRadius: '10px', objectFit: 'cover' }} />
              </div>
              <button onClick={endCall} style={{ marginTop: '30px', padding: '15px 30px', backgroundColor: '#ff3b30', color: 'white', border: 'none', borderRadius: '50px', fontSize: '16px', cursor: 'pointer' }}>📞 End Call</button>
            </div>
          )}

          <div className="chat-body">
            {messages.map((msg, index) => (
              <div key={index} className={`message ${msg.sender === 'me' ? 'sent' : 'received'}`} style={{ display: 'flex', alignItems: 'flex-end', gap: '5px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {msg.type === 'text' && <span>{msg.content}</span>}
                  {msg.type === 'audio' && <audio src={msg.content} controls style={{ height: '40px', width: '200px' }} />}
                  {msg.type === 'image' && <img src={msg.content} alt="shared media" style={{ maxWidth: '250px', borderRadius: '8px' }} />}
                </div>
                {/* BLUE TICKS */}
                {msg.sender === 'me' && (
                  <span style={{ fontSize: '11px', color: msg.is_read ? '#53bdeb' : '#8696a0', marginBottom: '2px' }}>
                    {msg.is_read ? "✓✓" : "✓"}
                  </span>
                )}
              </div>
            ))}
          </div>

          {showEmojis && (
            <div style={{ position: 'absolute', bottom: '80px', right: '20px', zIndex: 1000 }}>
              <EmojiPicker onEmojiClick={onEmojiClick} />
            </div>
          )}

          <div className="chat-footer">
            <button className="icon-btn" onClick={() => setShowEmojis(!showEmojis)}>😀</button>
            <input type="file" accept="image/*" style={{ display: 'none' }} ref={fileInputRef} onChange={handleImageUpload} />
            <button className="icon-btn" onClick={() => fileInputRef.current.click()}>📎</button>
            <div className="input-container">
              <input type="text" className="chat-input" placeholder="Type a message" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMessage()} />
            </div>
            {input.trim() !== "" ? (
              <button className="icon-btn" onClick={sendMessage}>➤</button>
            ) : (
              <button className="icon-btn" style={{ color: isRecording ? '#ff3b30' : '#54656f' }} onMouseDown={startRecording} onMouseUp={stopRecording} onMouseLeave={stopRecording}>🎤</button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;