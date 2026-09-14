import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowPathIcon, CubeIcon } from "@heroicons/react/24/outline";

import Layout from "@/components/common/Layout";
import { PageHeader } from "@/components/common/PageHeader";
import { getExperimentsModelList } from "../api/experiments";
import { IRegisteredModelLatestVersions } from "@/components/model/experiments.interface";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { formatDateTime } from "@/lib/format";
import { notifyError } from "@/lib/notify";

export function RegisteredModelsPage() {
  const [models, setModels] = useState<IRegisteredModelLatestVersions[]>();
  const [refreshing, setRefreshing] = useState(false);

  // Only each model's production version is listed: that is the one the
  // upload page offers.
  const getModels = async () => {
    const resp = await getExperimentsModelList();
    setModels(
      resp.registered_models
        .map((model) =>
          Array.isArray(model.latest_versions)
            ? model.latest_versions.find((v) => v.current_stage === "Production")
            : undefined
        )
        .filter((v): v is IRegisteredModelLatestVersions => v !== undefined)
    );
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await getModels();
    } catch {
      notifyError("Couldn’t Refresh Models", "Try again in a moment.");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    getModels().catch(() => setModels([]));
  }, []);

  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader
        title="Registered Models"
        description="Models published to production, with the version the upload page offers."
        actions={
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? <Spinner /> : <ArrowPathIcon aria-hidden="true" />}
            Refresh
          </Button>
        }
      />

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Version</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!models ? (
              Array.from({ length: 5 }, (_, row) => (
                <TableRow key={row}>
                  {Array.from({ length: 3 }, (_, cell) => (
                    <TableCell key={cell}>
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : models.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3} className="p-0">
                  <Empty className="py-16">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <CubeIcon aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle>No Published Models</EmptyTitle>
                      <EmptyDescription>
                        Publish a run from Experiments to list its model here.
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Link href="/experiments/experiments" passHref>
                        <Button asChild size="sm" variant="outline">
                          <a>Go to Experiments</a>
                        </Button>
                      </Link>
                    </EmptyContent>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              models.map((model) => (
                <TableRow key={`${model.name}-${model.version}`}>
                  <TableCell className="font-medium">{model.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{model.version}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatDateTime(model.creation_timestamp)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

RegisteredModelsPage.Layout = Layout;
RegisteredModelsPage.title = "Registered Models";
export default RegisteredModelsPage;
