import React, { useEffect, useState } from 'react';

const AvatarPage = ({ onSelectAvatar }) => {
    const [avatars, setAvatars] = useState([]);
    const [selected, setSelected] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        fetch('http://localhost:3001/api/avatars')
            .then(res => res.json())
            .then(setAvatars)
            .catch(() => setError('Failed to load avatars'));
    }, []);

    const handleSelect = (avatar) => {
        setSelected(avatar);
    };

    const handleContinue = () => {
        if (selected) onSelectAvatar(selected);
    };

    return (
        <div>
            <h2>Choose Your Avatar</h2>
            {error && <div style={{ color: 'red' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 20 }}>
                {avatars.map(avatar => (
                    <div key={avatar.id} style={{ border: selected?.id === avatar.id ? '2px solid blue' : '1px solid gray', padding: 10, cursor: 'pointer' }} onClick={() => handleSelect(avatar)}>
                        <img src={`${avatar.image}`} alt={avatar.name} width={64} height={64}  /><br />
                        {avatar.name}
                    </div>
                ))}
            </div>
            <button onClick={handleContinue} disabled={!selected} style={{ marginTop: 20 }}>Continue</button>
        </div>
    );
};

export default AvatarPage; 