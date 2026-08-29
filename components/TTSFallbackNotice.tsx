import React, { useEffect, useState } from 'react';

interface TTSFallbackNoticeProps {
  trigger: number;
}

const TTSFallbackNotice: React.FC<TTSFallbackNoticeProps> = ({ trigger }) => {
  const [isVisible, setIsVisible] = useState(trigger > 0);

  useEffect(() => {
    if (trigger <= 0) return undefined;
    setIsVisible(true);
    const timer = window.setTimeout(() => setIsVisible(false), 5_000);
    return () => window.clearTimeout(timer);
  }, [trigger]);

  if (!isVisible) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lingoblitz bg-gray-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-gray-100 dark:text-gray-900"
    >
      Voxtral ist gerade nicht verfügbar – Browser-Stimme wird verwendet.
    </div>
  );
};

export default TTSFallbackNotice;
