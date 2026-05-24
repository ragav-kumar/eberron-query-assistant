import { useMutation } from '@tanstack/react-query';
import { mutateApi } from '@/client/api/utils.js';
import type { CreateRunDto } from '@/dto/index.js';

import { contracts } from '@/contract/index.js';

export const useRunsMutation = () => useMutation({
        mutationFn: (payload: CreateRunDto) => mutateApi(contracts.runs.post, payload),
    });
