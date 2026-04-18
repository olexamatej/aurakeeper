import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import type { ErrorLog } from "@/lib/types"

interface ErrorLogDetailProps {
  log: ErrorLog
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  )
}

function KeyValue({ label, value }: { label: string; value?: string | boolean | null }) {
  if (value === undefined || value === null) return null
  const display = typeof value === "boolean" ? (value ? "Yes" : "No") : value
  return (
    <div className="flex gap-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}:</span>
      <span className="break-all">{display}</span>
    </div>
  )
}

function JsonBlock({ data }: { data: unknown }) {
  if (!data) return null
  return (
    <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

export function ErrorLogDetail({ log }: ErrorLogDetailProps) {
  return (
    <div className="space-y-4 px-4 pb-4 pt-2">
      <Section title="Error">
        <div className="space-y-1">
          <KeyValue label="Type" value={log.error.type} />
          <KeyValue label="Message" value={log.error.message} />
          <KeyValue label="Code" value={log.error.code} />
          <KeyValue label="Handled" value={log.error.handled} />
        </div>
        {log.error.stack && (
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {log.error.stack}
          </pre>
        )}
        {log.error.details && (
          <>
            <p className="mt-2 text-xs text-muted-foreground">Details</p>
            <JsonBlock data={log.error.details} />
          </>
        )}
      </Section>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Service">
          <div className="space-y-1">
            <KeyValue label="Name" value={log.service.name} />
            <KeyValue label="Version" value={log.service.version} />
            <KeyValue label="Instance" value={log.service.instanceId} />
          </div>
        </Section>

        <Section title="Source">
          <div className="space-y-1">
            <KeyValue label="Runtime" value={log.source.runtime} />
            <KeyValue label="Language" value={log.source.language} />
            <KeyValue label="Framework" value={log.source.framework} />
            <KeyValue label="Component" value={log.source.component} />
          </div>
        </Section>
      </div>

      {log.context && (
        <>
          <Separator />
          <Section title="Context">
            {log.context.tags && log.context.tags.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {log.context.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
            <JsonBlock data={log.context} />
          </Section>
        </>
      )}

      <Separator />

      <Section title="Metadata">
        <div className="grid gap-1 sm:grid-cols-2">
          <KeyValue label="Log ID" value={log.id} />
          <KeyValue label="Event ID" value={log.eventId} />
          <KeyValue label="Occurred at" value={log.occurredAt} />
          <KeyValue label="Received at" value={log.receivedAt} />
        </div>
      </Section>
    </div>
  )
}
