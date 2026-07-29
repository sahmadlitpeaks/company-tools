import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function NotFoundPage() {
  const location = useLocation();
  return (
    <div className="grid place-items-center py-20 text-center">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="text-6xl font-bold text-primary">404</div>
          <CardTitle>Page not found</CardTitle>
        </CardHeader>
        <CardContent>
        <p className="text-muted-foreground">
          We couldn't find{" "}
          <code className="break-all">{location.pathname}</code>.
        </p>
        </CardContent>
        <CardFooter className="justify-center"><Button render={<Link to="/" />}>← Back to dashboard</Button></CardFooter>
      </Card>
    </div>
  );
}
