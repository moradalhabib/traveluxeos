import { useState } from "react";
import { useListUsers, getListUsersQueryKey, useListAuditLog, getListAuditLogQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

export default function Admin() {
  const { data: users, isLoading: usersLoading } = useListUsers(
    { query: { enabled: true, queryKey: getListUsersQueryKey() } }
  );

  const { data: logs, isLoading: logsLoading } = useListAuditLog(
    {}, 
    { query: { enabled: true, queryKey: getListAuditLogQueryKey({}) } }
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Admin Panel</h1>
      </div>

      <Tabs defaultValue="users" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>
        
        <TabsContent value="users" className="mt-6">
          <Card className="border-border">
            <CardHeader>
              <CardTitle>System Operators</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {usersLoading ? (
                  [...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)
                ) : users?.map((user) => (
                  <div key={user.id} className="flex justify-between items-center p-3 border border-border rounded-lg bg-background/50">
                    <div>
                      <div className="font-bold">{user.name}</div>
                      <div className="text-sm text-muted-foreground">{user.email}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className={user.role === 'admin' ? 'border-primary text-primary' : ''}>
                        {user.role}
                      </Badge>
                      <Badge variant={user.active ? "outline" : "destructive"} className={user.active ? 'text-green-500' : ''}>
                        {user.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-6">
          <Card className="border-border">
            <CardHeader>
              <CardTitle>System Audit Trail</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {logsLoading ? (
                  [...Array(5)].map((_, i) => <Skeleton key={i} className="h-20" />)
                ) : logs?.map((log) => (
                  <div key={log.id} className="flex flex-col sm:flex-row sm:items-start justify-between p-3 border border-border rounded-lg bg-background/50 gap-2">
                    <div>
                      <div className="font-medium text-sm flex items-center gap-2">
                        {log.operator_name || 'System'}
                        <Badge variant="secondary" className="text-[10px]">{log.action}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {log.entity_type} {log.entity_id}
                      </div>
                      {log.detail && <div className="text-sm mt-1">{log.detail}</div>}
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(log.created_at), 'PPp')}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
