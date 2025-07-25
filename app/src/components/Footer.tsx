const Footer = () => {
  return (
    <footer className="w-full py-6 text-center text-muted-foreground border-t border-black/10 dark:border-white/10 bg-white dark:bg-[#0E0E0E] animate-fade-in">
      <div className="container">
        &copy; {new Date().getFullYear()} The Deed Protocol by Deed3Labs.
      </div>
    </footer>
  );
};

export default Footer; 