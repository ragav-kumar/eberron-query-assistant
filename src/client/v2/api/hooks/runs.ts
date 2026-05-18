import { useMutation } from '@tanstack/react-query';
import { mutateApi } from '@/client/v2/api/utils.js';
import type { CreateRun } from '@/dto/index.js';

import { contracts } from '@/contract/index.js';

export const useRunsMutation = () => useMutation({
        mutationFn: (payload: CreateRun) => mutateApi(contracts.runs.post, payload),
    });
