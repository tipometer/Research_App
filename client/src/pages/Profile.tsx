import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download, Shield, Trash2, User } from "lucide-react";

export default function Profile() {
  const { user } = useAuth();
  const { t } = useTranslation();

  return (
    <AppLayout>
      <div className="p-8 max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Profil beállítások</h1>
          <p className="text-muted-foreground text-sm mt-1">Fiókod kezelése és GDPR jogok</p>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-base">Személyes adatok</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Név</Label>
                <Input defaultValue={user?.name ?? ""} />
              </div>
              <div className="space-y-2">
                <Label>E-mail</Label>
                <Input defaultValue={user?.email ?? ""} disabled />
              </div>
              <Button onClick={() => toast.success("Adatok mentve!")}>Mentés</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-base">GDPR jogok</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Az EU GDPR rendelet alapján jogod van adataid letöltéséhez és törléséhez.</p>
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" className="gap-2" onClick={() => toast.info("Adatexport elkészítése... (hamarosan)")}>
                  <Download className="w-4 h-4" />
                  Adataim letöltése
                </Button>
                <Button variant="outline" className="gap-2 text-destructive hover:text-destructive" onClick={() => toast.error("Fiók törlés — hamarosan")}>
                  <Trash2 className="w-4 h-4" />
                  Fiók törlése
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
