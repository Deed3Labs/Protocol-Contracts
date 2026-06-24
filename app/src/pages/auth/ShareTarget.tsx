import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle } from 'lucide-react';

/**
 * Share Target Page
 * Handles incoming shared data from Web Share Target API
 */
export function ShareTarget() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [sharedData, setSharedData] = useState<{
    title?: string;
    text?: string;
    url?: string;
  } | null>(null);

  useEffect(() => {
    // Get shared data from URL parameters
    const title = searchParams.get('title');
    const text = searchParams.get('text');
    const url = searchParams.get('url');

    if (title || text || url) {
      setSharedData({ title: title || undefined, text: text || undefined, url: url || undefined });
    }
  }, [searchParams]);

  const handleProcess = () => {
    if (!sharedData) return;

    // Process the shared data
    // For wallet addresses, navigate to portfolio
    if (sharedData.text && /^0x[a-fA-F0-9]{40}$/.test(sharedData.text.trim())) {
      // It's a wallet address
      navigate(`/portfolio?address=${sharedData.text.trim()}`);
      return;
    }

    // For transaction hashes, navigate to transaction view
    if (sharedData.text && /^0x[a-fA-F0-9]{64}$/.test(sharedData.text.trim())) {
      // It's a transaction hash
      navigate(`/transaction/${sharedData.text.trim()}`);
      return;
    }

    // For URLs, try to extract useful information
    if (sharedData.url) {
      try {
        const url = new URL(sharedData.url);
        // Handle different URL patterns
        if (url.pathname.includes('/tx/')) {
          const hash = url.pathname.split('/tx/')[1];
          navigate(`/transaction/${hash}`);
          return;
        }
        if (url.pathname.includes('/address/')) {
          const address = url.pathname.split('/address/')[1];
          navigate(`/portfolio?address=${address}`);
          return;
        }
      } catch (error) {
        console.error('[ShareTarget] Failed to parse URL:', error);
      }
    }

    // Default: navigate to home
    navigate('/');
  };

  if (!sharedData) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>No Shared Data</CardTitle>
            <CardDescription>No data was shared to this app.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/')} className="w-full">
              Go Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Shared Content Received</CardTitle>
          <CardDescription>Process the shared data below</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sharedData.title && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Title</p>
              <p className="text-sm">{sharedData.title}</p>
            </div>
          )}
          {sharedData.text && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Text</p>
              <p className="text-sm break-all">{sharedData.text}</p>
            </div>
          )}
          {sharedData.url && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">URL</p>
              <p className="text-sm break-all text-blue-500">{sharedData.url}</p>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={handleProcess} className="flex-1">
              <CheckCircle className="w-4 h-4 mr-2" />
              Process
            </Button>
            <Button onClick={() => navigate('/')} variant="outline" className="flex-1">
              <XCircle className="w-4 h-4 mr-2" />
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
