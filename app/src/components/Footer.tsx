import { useState } from 'react';
import { Github, Mail } from 'lucide-react';

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
      <div className="relative w-full max-w-5xl h-[85vh] bg-white dark:bg-[#141414] rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-[#141414]">
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
      <footer className="hidden md:block w-full py-6 text-muted-foreground border-t border-black/10 dark:border-white/10 bg-white dark:bg-[#0E0E0E] animate-fade-in">
        <div className="container flex items-center justify-between">
          {/* Left Side - Social Media Icons */}
          <div className="flex items-center space-x-3">
            {/* Github */}
            <a
              href="https://github.com/Deed3Labs"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Follow us on Github"
            >
              <Github className="w-5 h-5" />
            </a>
            
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
            
            {/* Mail */}
            <a
              href="mailto:support@deed3.io"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Contact us via email"
            >
              <Mail className="w-5 h-5" />
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