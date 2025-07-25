const Footer = () => {
  return (
    <footer className="w-full py-6 text-center text-muted-foreground border-t border-border bg-[#0E0E0E] dark:bg-[#0E0E0E] animate-fade-in">
      <div className="container">
        &copy; {new Date().getFullYear()} The Deed Protocol by Deed3Labs.
      </div>
    </footer>
  );
};

export default Footer; 