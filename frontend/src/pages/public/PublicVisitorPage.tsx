import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { apiUrl } from "../../api/client";
import { useFetch } from "../../hooks/useApi";
import { Loading } from "../../components/ui";

type Invitation = { visitor_name: string; host_name: string; office_location: string; visit_at: string; purpose?: string; maps_url?: string };

export default function PublicVisitorPage() {
  const { token } = useParams();
  const invitation = useFetch<Invitation>(token ? `/api/public/visitors/${token}` : null);
  if (invitation.loading) return <Loading />;
  if (!invitation.data) {
    return (
      <main className="grid min-h-dvh place-items-center bg-muted p-6">
        <Card className="w-full max-w-lg">
          <CardHeader><CardTitle>Invitation unavailable</CardTitle></CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-muted p-6">
      <Card className="w-full max-w-lg text-center">
        <CardHeader><CardTitle>Visitor invitation</CardTitle></CardHeader>
        <CardContent className="flex flex-col items-center gap-5">
          <p>Welcome, <strong>{invitation.data.visitor_name}</strong></p>
          <img
            className="size-48"
            src={apiUrl(`/api/public/visitors/${token}/qr.png`)}
            alt="Visitor invitation QR code"
          />
          <p>
            {invitation.data.office_location}<br />
            {new Date(invitation.data.visit_at).toLocaleString()}<br />
            Host: {invitation.data.host_name}
          </p>
        </CardContent>
        {invitation.data.maps_url && (
          <CardFooter className="justify-center">
            <Button render={<a href={invitation.data.maps_url} />}>Open in Google Maps</Button>
          </CardFooter>
        )}
      </Card>
    </main>
  );
}
