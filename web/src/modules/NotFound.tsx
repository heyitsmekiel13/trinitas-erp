import { useNavigate } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/feedback'

export function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="card">
      <EmptyState
        icon={Compass}
        title="This page does not exist"
        description="The module you followed is not part of the ERP, or the address was mistyped. Press Ctrl+K to search every module."
        action={
          <Button variant="primary" onClick={() => navigate('/')}>
            Back to Command Center
          </Button>
        }
      />
    </div>
  )
}
