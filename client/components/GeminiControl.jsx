import { useState, useEffect } from 'react';

export default function GeminiControl() {
  const [isGeminiEnabled, setIsGeminiEnabled] = useState(true);

  useEffect(() => {
    // Fetch initial setting
    fetch('/api/gemini-setting')
      .then(res => res.json())
      .then(data => setIsGeminiEnabled(data.isGeminiEnabled))
      .catch(err => console.error('Error fetching Gemini setting:', err));
  }, []);

  const toggleGemini = async () => {
    try {
      const response = await fetch('/api/toggle-gemini', {
        method: 'POST',
      });
      const data = await response.json();
      setIsGeminiEnabled(data.isGeminiEnabled);
    } catch (error) {
      console.error('Error toggling Gemini:', error);
    }
  };

  return (
    <div className="flex items-center gap-2 p-2 bg-gray-100 rounded">
      <input
        type="checkbox"
        id="geminiEnabled"
        checked={isGeminiEnabled}
        onChange={toggleGemini}
        className="w-4 h-4"
      />
      <label htmlFor="geminiEnabled" className="text-sm">
        Enable Gemini Analysis
      </label>
    </div>
  );
} 