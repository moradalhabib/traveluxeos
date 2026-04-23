import { useState } from "react";
import { useListMessages, getListMessagesQueryKey, useListTasks, getListTasksQueryKey, useCreateTask, useCompleteTask, useSendMessage } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { CheckCircle2, Send, AlertCircle, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { ActivityPanel } from "@/components/activity/ActivityPanel";

export default function Messages() {
  const { user } = useAuth();
  const [messageText, setMessageText] = useState("");
  // Per-task expanded activity feed. Tasks have no standalone detail page,
  // so we let the operator open the audit history inline from the task
  // card here. Mirrors the per-product activity drawer on supplier detail.
  const [openActivityId, setOpenActivityId] = useState<string | null>(null);

  const { data: messages, isLoading: msgLoading, refetch: refetchMsgs } = useListMessages(
    { channel: "team" }, 
    { query: { enabled: true, queryKey: getListMessagesQueryKey({ channel: "team" }) } }
  );

  const { data: tasks, isLoading: tasksLoading, refetch: refetchTasks } = useListTasks(
    { query: { enabled: true, queryKey: getListTasksQueryKey() } }
  );

  const sendMsg = useSendMessage();
  const completeTask = useCompleteTask();

  const handleSend = () => {
    if (!messageText.trim()) return;
    sendMsg.mutate({ data: { content: messageText, channel: "team" } }, {
      onSuccess: () => {
        setMessageText("");
        refetchMsgs();
      }
    });
  };

  const handleCompleteTask = (id: string) => {
    completeTask.mutate({ id }, {
      onSuccess: () => refetchTasks()
    });
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'Urgent': return 'text-destructive border-destructive/20 bg-destructive/10';
      case 'Medium': return 'text-amber-500 border-amber-500/20 bg-amber-500/10';
      default: return 'text-primary border-primary/20 bg-primary/10';
    }
  };

  return (
    <div className="space-y-6 h-[calc(100vh-100px)] md:h-[calc(100vh-80px)] flex flex-col">
      <h1 className="text-3xl font-bold tracking-tight text-foreground shrink-0">Messages & Tasks</h1>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden">
        <Card className="lg:col-span-2 border-primary/10 flex flex-col overflow-hidden bg-card">
          <Tabs defaultValue="team" className="flex flex-col h-full">
            <CardHeader className="pb-0 shrink-0">
              <TabsList>
                <TabsTrigger value="team">Team Chat</TabsTrigger>
                <TabsTrigger value="direct">Direct</TabsTrigger>
                <TabsTrigger value="announcements">Announcements</TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-4 overflow-hidden mt-2">
              <TabsContent value="team" className="flex-1 flex flex-col h-full mt-0 data-[state=active]:flex">
                <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
                  {msgLoading ? (
                    [...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-3/4 rounded-lg" />)
                  ) : messages?.map((msg) => {
                    const isMe = msg.sender_id === user?.id;
                    return (
                      <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                        <div className="text-xs text-muted-foreground mb-1 ml-1">{msg.sender_name} • {format(new Date(msg.created_at), 'HH:mm')}</div>
                        <div className={`p-3 rounded-xl max-w-[80%] ${isMe ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-secondary text-secondary-foreground rounded-tl-sm'}`}>
                          {msg.content}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="shrink-0 flex gap-2 pt-2 border-t border-border">
                  <Input 
                    value={messageText} 
                    onChange={e => setMessageText(e.target.value)} 
                    placeholder="Type a message..." 
                    className="flex-1 h-12"
                    onKeyDown={e => e.key === 'Enter' && handleSend()}
                  />
                  <Button onClick={handleSend} className="h-12 px-6 shadow-[0_0_10px_rgba(201,168,76,0.2)]">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="direct" className="h-full flex items-center justify-center text-muted-foreground">
                Direct messages coming soon
              </TabsContent>
              <TabsContent value="announcements" className="h-full flex items-center justify-center text-muted-foreground">
                No new announcements
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>

        <Card className="border-primary/10 flex flex-col overflow-hidden bg-card">
          <CardHeader className="shrink-0">
            <CardTitle className="flex justify-between items-center">
              Tasks
              <Badge variant="outline">{tasks?.filter(t => !t.completed).length || 0} Pending</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
            {tasksLoading ? (
              [...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)
            ) : tasks?.filter(t => !t.completed).map((task) => (
              <div key={task.id} className="p-3 border border-border rounded-lg bg-background/50 space-y-2">
                <div className="flex items-start gap-3">
                  <button onClick={() => handleCompleteTask(task.id)} className="mt-1 text-muted-foreground hover:text-green-500 transition-colors">
                    <CheckCircle2 className="w-5 h-5" />
                  </button>
                  <div className="flex-1">
                    <div className="font-medium text-sm text-foreground">{task.title}</div>
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-xs text-muted-foreground">{task.assigned_to_name}</span>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${getPriorityColor(task.priority)}`}>
                          {task.priority}
                        </Badge>
                        <button
                          type="button"
                          onClick={() => setOpenActivityId(openActivityId === task.id ? null : task.id)}
                          className="text-[10px] text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                          data-testid={`btn-task-activity-${task.id}`}
                        >
                          <History className="w-3 h-3" />
                          {openActivityId === task.id ? "Hide" : "Activity"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                {openActivityId === task.id && (
                  <ActivityPanel
                    entityType="task"
                    entityId={task.id}
                    title="Task activity"
                    description="Assignments and completions for this task."
                    limit={10}
                  />
                )}
              </div>
            ))}
            {tasks?.filter(t => !t.completed).length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm flex flex-col items-center gap-2">
                <CheckCircle2 className="w-8 h-8 opacity-50" />
                All caught up!
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
