import { useState } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  url: string;
}

const Modal = ({ isOpen, onClose, title, url }: ModalProps) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-5xl h-[85vh] bg-white dark:bg-gray-900 rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Iframe Container */}
        <div className="h-full w-full">
          <iframe
            src={url}
            className="w-full h-full border-0"
            title={title}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      </div>
    </div>
  );
};

const Footer = () => {
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    title: string;
    url: string;
  }>({
    isOpen: false,
    title: '',
    url: ''
  });

  const openModal = (title: string, url: string) => {
    setModalState({
      isOpen: true,
      title,
      url
    });
  };

  const closeModal = () => {
    setModalState(prev => ({ ...prev, isOpen: false }));
  };

  return (
    <>
      <footer className="w-full py-6 text-muted-foreground border-t border-black/10 dark:border-white/10 bg-white dark:bg-[#0E0E0E] animate-fade-in">
        <div className="container flex items-center justify-between">
          {/* Left Side - Social Media Icons */}
          <div className="flex items-center space-x-3">
            {/* X (Twitter) */}
            <a
              href="https://x.com/Deed3Labs"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Follow us on X (Twitter)"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            </a>
            
            {/* LinkedIn */}
            <a
              href="https://linkedin.com/company/Deed3Labs"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Follow us on LinkedIn"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
            </a>
            
            {/* Farcaster */}
            <a
              href="https://farcaster.xyz/Deed3Labs"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Follow us on Farcaster"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </a>
          </div>
          
          {/* Center - Copyright */}
          <div className="text-center">
            &copy; {new Date().getFullYear()} The Deed Protocol by Deed3Labs.
          </div>
          
          {/* Right Side - Documentation Links */}
          <div className="flex items-center space-x-6 text-sm">
            <button
              onClick={() => openModal('Documentation', 'https://docs.deedprotocol.org/')}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Docs
            </button>
            <button
              onClick={() => openModal('Terms of Service', 'https://docs.deedprotocol.org/legal-framework/traditional-legal-agreements/terms-of-service')}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Terms
            </button>
            <button
              onClick={() => openModal('Privacy Policy', 'https://docs.deedprotocol.org/legal-framework/traditional-legal-agreements/privacy-policy')}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Privacy
            </button>
          </div>
        </div>
      </footer>

      <Modal
        isOpen={modalState.isOpen}
        onClose={closeModal}
        title={modalState.title}
        url={modalState.url}
      />
    </>
  );
};

export default Footer; 