import { useState, useEffect } from 'react';

export default function LogDeletionControl() {
  const [shouldDeleteLogs, setShouldDeleteLogs] = useState(true);

  useEffect(() => {
    // Fetch initial setting
    fetch('/api/log-deletion-setting')
      .then(res => res.json())
      .then(data => setShouldDeleteLogs(data.shouldDeleteLogs))
      .catch(err => console.error('Error fetching log deletion setting:', err));
  }, []);

  const toggleLogDeletion = async () => {
    try {
      const response = await fetch('/api/toggle-log-deletion', {
        method: 'POST',
      });
      const data = await response.json();
      setShouldDeleteLogs(data.shouldDeleteLogs);
    } catch (error) {
      console.error('Error toggling log deletion:', error);
    }
  };

  return (
    <div className="flex items-center gap-2 p-2 bg-gray-100 rounded">
      <input
        type="checkbox"
        id="logDeletion"
        checked={shouldDeleteLogs}
        onChange={toggleLogDeletion}
        className="w-4 h-4"
      />
      <label htmlFor="logDeletion" className="text-sm">
        Delete logs on session end
      </label>
    </div>
  );
} 